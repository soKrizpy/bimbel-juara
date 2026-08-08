const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
);

const app = {
  session: null,
  user: null,
  profile: null,
  view: "overview",
  data: {
    profiles: [],
    categories: [],
    packages: [],
    questions: [],
    assignments: [],
    attempts: [],
    attemptAnswers: [],
    systemSettings: [],
    auditLogs: [],
  },
  exam: null,
  timers: [],
  busy: false,
  setupWarnings: [],
};

const ROLE_ORDER = ["student", "admin", "superadmin"];

const VIEW_META = {
  overview: {
    title: "Ringkasan",
    description: "",
  },
  packages: {
    title: "Paket Soal",
    description: "",
  },
  questions: {
    title: "Bank Soal",
    description: "",
  },
  assignments: {
    title: "Assignment",
    description: "",
  },
  import: {
    title: "Import CSV",
    description: "",
  },
  users: {
    title: "Pengguna",
    description: "",
  },
  superadmin: {
    title: "Superadmin Console",
    description: "",
  },
  exams: {
    title: "Ujian Saya",
    description: "",
  },
  results: {
    title: "Hasil & Analisis",
    description: "",
  },
  exam: {
    title: "Mengerjakan Soal",
    description: "",
  },
};

const CSV_TEMPLATE = `package_title,category_name,question_text,option_a,option_b,option_c,option_d,correct_option,explanation,points,order_index
Paket ANBK Matematika,Matematika,2 + 2 = ?,3,4,5,6,B,Penjumlahan dasar menghasilkan 4.,1,1
Paket ANBK Matematika,Matematika,5 x 3 = ?,15,10,8,20,A,Perkalian 5 dengan 3 adalah 15.,1,2`;

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function roleLabel(role) {
  if (!role) return "-";
  return role.toUpperCase();
}

function settingsMap() {
  return Object.fromEntries(
    app.data.systemSettings.map((item) => [item.key, item.value]),
  );
}

function settingValue(key, fallback = "") {
  const map = settingsMap();
  return map[key] ?? fallback;
}

function boolSetting(key, fallback = false) {
  return String(settingValue(key, String(fallback))).toLowerCase() === "true";
}

function numberSetting(key, fallback = 0) {
  const parsed = Number(settingValue(key, String(fallback)));
  return Number.isNaN(parsed) ? fallback : parsed;
}

function isAdminLike() {
  return app.profile?.role === "admin" || app.profile?.role === "superadmin";
}

function isSuperadmin() {
  return app.profile?.role === "superadmin";
}

function setAlert(html) {
  const el = $("alert-area");
  if (el) {
    el.innerHTML = html || "";
  }
}

function toast(message, type = "info") {
  const stack = $("toast-stack");
  if (!stack) return;
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  stack.appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateY(6px)";
  }, 2600);
  setTimeout(() => node.remove(), 3200);
}

function openModal(html) {
  const modal = $("modal");
  const content = $("modal-content");
  if (!modal || !content) return;
  content.innerHTML = html;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  const modal = $("modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function downloadTextFile(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function parseCsv(text) {
  const rows = [];
  let current = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      current.push(field.trim());
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      current.push(field.trim());
      field = "";
      if (current.some((item) => item !== "")) {
        rows.push(current);
      }
      current = [];
      continue;
    }

    field += char;
  }

  if (field.length || current.length) {
    current.push(field.trim());
    if (current.some((item) => item !== "")) {
      rows.push(current);
    }
  }

  return rows;
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((item) => item.trim());
  return rows.slice(1).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    return record;
  });
}

function csvEscape(value) {
  const raw = String(value ?? "");
  if (raw.includes('"') || raw.includes(",") || raw.includes("\n")) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function csvFromObjects(rows, headers) {
  const headerLine = headers.join(",");
  const dataLines = rows.map((row) =>
    headers.map((header) => csvEscape(row[header])).join(","),
  );
  return [headerLine, ...dataLines].join("\n");
}

function findCategoryName(categoryId) {
  return app.data.categories.find((item) => String(item.id) === String(categoryId))
    ?.name || "-";
}

function findPackage(packageId) {
  return app.data.packages.find((item) => String(item.id) === String(packageId));
}

function findProfile(profileId) {
  return app.data.profiles.find((item) => String(item.id) === String(profileId));
}

function assignedPackagesForCurrentUser() {
  const className = app.profile?.class_name || "";
  return app.data.assignments
    .filter((assignment) => {
      const byUser =
        assignment.assigned_to_user &&
        String(assignment.assigned_to_user) === String(app.user.id);
      const byClass =
        className &&
        assignment.assigned_to_class &&
        assignment.assigned_to_class.toLowerCase() === className.toLowerCase();
      return byUser || byClass;
    })
    .map((assignment) => ({
      ...assignment,
      package: findPackage(assignment.package_id),
    }))
    .filter((assignment) => assignment.package);
}

async function fetchTable(name, builder) {
  const { data, error } = await builder;
  if (error) {
    app.setupWarnings.push(`${name}: ${error.message}`);
    return [];
  }
  return data || [];
}

async function refreshData() {
  app.setupWarnings = [];
  const base = {
    categories: supabaseClient.from("categories").select("*").order("name"),
    packages: supabaseClient
      .from("question_packages")
      .select("*")
      .order("created_at", { ascending: false }),
    questions: supabaseClient
      .from("questions")
      .select("*")
      .order("created_at", { ascending: false }),
    assignments: supabaseClient
      .from("assignments")
      .select("*")
      .order("created_at", { ascending: false }),
    systemSettings: supabaseClient
      .from("system_settings")
      .select("*")
      .order("key"),
  };

  const profileQuery = isAdminLike()
    ? supabaseClient.from("profiles").select("*").order("created_at", { ascending: false })
    : supabaseClient
        .from("profiles")
        .select("*")
        .or(`id.eq.${app.user.id},role.eq.superadmin,role.eq.admin`)
        .order("created_at", { ascending: false });

  const attemptsQuery = isAdminLike()
    ? supabaseClient.from("attempts").select("*").order("created_at", { ascending: false })
    : supabaseClient
        .from("attempts")
        .select("*")
        .eq("user_id", app.user.id)
        .order("created_at", { ascending: false });

  const auditLogsQuery = isSuperadmin()
    ? supabaseClient
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50)
    : Promise.resolve({ data: [], error: null });

  const [categories, packages, questions, assignments, systemSettings, profiles, attempts, auditLogs] =
    await Promise.all([
    fetchTable("categories", base.categories),
    fetchTable("question_packages", base.packages),
    fetchTable("questions", base.questions),
    fetchTable("assignments", base.assignments),
    fetchTable("system_settings", base.systemSettings),
    fetchTable("profiles", profileQuery),
    fetchTable("attempts", attemptsQuery),
    fetchTable("audit_logs", auditLogsQuery),
  ]);

  app.data.categories = categories;
  app.data.packages = packages;
  app.data.questions = questions;
  app.data.assignments = assignments;
  app.data.systemSettings = systemSettings;
  app.data.profiles = profiles;
  app.data.attempts = attempts;
  app.data.auditLogs = auditLogs;

  renderShell();
}

function pageMeta(view) {
  return VIEW_META[view] || VIEW_META.overview;
}

function navigate(view) {
  app.view = view;
  renderShell();
}

function renderShell() {
  const meta = pageMeta(app.view);
  const role = app.profile?.role || "student";
  const displayName = app.profile?.username || app.profile?.email || app.user?.email || "-";

  const pageTitle = $("page-title");
  const pageDescription = $("page-description");
  const sidebarRole = $("sidebar-role");
  const topbarRole = $("topbar-role");
  const sidebarUser = $("sidebar-user");
  const topbarUser = $("topbar-user");
  const nav = $("sidebar-nav");
  const stats = $("stats-container");
  const content = $("content");

  if (pageTitle) pageTitle.textContent = meta.title;
  if (pageDescription) pageDescription.textContent = meta.description || "";
  if (sidebarRole) sidebarRole.textContent = roleLabel(role);
  if (topbarRole) topbarRole.textContent = roleLabel(role);
  if (sidebarUser) sidebarUser.textContent = displayName;
  if (topbarUser) topbarUser.textContent = displayName;

  if (nav) nav.innerHTML = renderNav(role);
  if (stats) stats.innerHTML = renderStats();
  if (content) content.innerHTML = renderContent();

  setAlert(renderGlobalBanner() + renderSetupWarnings());
  bindCurrentView();
}

function renderNav(role) {
  const items = [
    { view: "overview", label: "Ringkasan", hint: "status" },
  ];

  if (role === "student") {
    items.push(
      { view: "exams", label: "Ujian Saya", hint: "assigned" },
      { view: "results", label: "Hasil Saya", hint: "history" },
    );
  } else {
    items.push(
      { view: "superadmin", label: "Superadmin", hint: "god mode" },
      { view: "packages", label: "Paket Soal", hint: "CRUD" },
      { view: "questions", label: "Bank Soal", hint: "MCQ" },
      { view: "assignments", label: "Assignment", hint: "target" },
      { view: "import", label: "Import CSV", hint: "bulk" },
      { view: "results", label: "Hasil & Analisis", hint: "report" },
    );
    if (role === "superadmin") {
      items.push({ view: "users", label: "Pengguna", hint: "role" });
    }
  }

  return items
    .map(
      (item) => `
        <button class="nav-item ${app.view === item.view ? "active" : ""}" data-view="${item.view}">
          <span>${escapeHtml(item.label)}</span>
          <small>${escapeHtml(item.hint)}</small>
        </button>`,
    )
    .join("");
}

function renderStats() {
  const totalPackages = app.data.packages.length;
  const totalQuestions = app.data.questions.length;
  const totalAssignments = app.data.assignments.length;
  const totalStudents = app.data.profiles.filter((item) => item.role === "student").length;
  const totalAttempts = app.data.attempts.length;
  const assignedCount = assignedPackagesForCurrentUser().length;
  const avgScore = app.data.attempts.length
    ? Math.round(
        app.data.attempts.reduce((sum, item) => sum + Number(item.score || 0), 0) /
          app.data.attempts.length,
      )
    : 0;

  const cards =
    app.profile?.role === "student"
      ? [
          { label: "Paket Tersedia", value: assignedCount },
          { label: "Riwayat Attempt", value: totalAttempts },
          { label: "Rata-rata Skor", value: avgScore },
          { label: "Soal Aktif", value: totalQuestions },
        ]
      : [
          { label: "Total Paket", value: totalPackages },
          { label: "Total Soal", value: totalQuestions },
          { label: "Assignment", value: totalAssignments },
          { label: "Siswa", value: totalStudents },
        ];

  return cards
    .map(
      (card) => `
        <article class="stats-card">
          <h3>${escapeHtml(card.label)}</h3>
          <strong>${escapeHtml(card.value)}</strong>
        </article>`,
    )
    .join("");
}

function renderSetupWarnings() {
  if (!app.setupWarnings.length) {
    return "";
  }

  return `
    <div class="section-card">
      <div class="help-box">
        <strong>Setup Supabase</strong>
        <ul class="mini-note">
          ${app.setupWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}
        </ul>
      </div>
    </div>`;
}

function renderGlobalBanner() {
  const announcement = settingValue("announcement", "").trim();
  const maintenanceMode = boolSetting("maintenance_mode", false);

  if (!announcement && !maintenanceMode) {
    return "";
  }

  return `
    <div class="section-card" style="margin-bottom:18px;">
      <div class="help-box">
        <strong>${maintenanceMode ? "Maintenance" : "Pengumuman"}</strong>
        <p class="mini-note">${escapeHtml(announcement || "Aktif")}</p>
      </div>
    </div>`;
}

function renderContent() {
  if (app.view === "overview") return renderOverview();
  if (app.view === "superadmin") return renderSuperadmin();
  if (app.view === "packages") return renderPackages();
  if (app.view === "questions") return renderQuestions();
  if (app.view === "assignments") return renderAssignments();
  if (app.view === "import") return renderImport();
  if (app.view === "users") return renderUsers();
  if (app.view === "exams") return renderExams();
  if (app.view === "results") return renderResults();
  if (app.view === "exam") return renderExam();
  return `<div class="section-card"><p>Halaman belum tersedia.</p></div>`;
}

function quickActionButtons() {
  if (app.profile?.role === "student") {
    return `
      <button class="btn btn-primary" data-go="exams">Lihat Ujian Saya</button>
      <button class="btn btn-secondary" data-go="results">Lihat Hasil</button>
    `;
  }

  if (app.profile?.role === "superadmin") {
    return `
      <button class="btn btn-primary" data-go="superadmin">Buka Control Center</button>
      <button class="btn btn-secondary" data-go="users">Kelola Pengguna</button>
      <button class="btn btn-secondary" data-go="results">Audit Hasil</button>
    `;
  }

  return `
    <button class="btn btn-primary" data-go="packages">Buat Paket</button>
    <button class="btn btn-secondary" data-go="import">Import CSV</button>
    <button class="btn btn-secondary" data-go="assignments">Buat Assignment</button>
  `;
}

function renderOverview() {
  const recentPackages = app.data.packages.slice(0, 4);
  const recentQuestions = app.data.questions.slice(0, 5);
  const recentAttempts = app.data.attempts.slice(0, 5);
  const assigned = assignedPackagesForCurrentUser().slice(0, 5);

  return `
    <section class="section-card">
      <div class="toolbar">
        <h3 class="page-title" style="font-size:1.4rem;margin-top:0.2rem;">Aksi</h3>
        <div class="toolbar-actions">${quickActionButtons()}</div>
      </div>
    </section>

    <section class="section-grid grid-2">
      <div class="table-card">
        <div class="toolbar">
          <h3>Paket</h3>
          <button class="btn btn-ghost" data-go="packages">Kelola</button>
        </div>
        <div class="preview-list">
          ${recentPackages.length ? recentPackages.map(renderPackagePreview).join("") : `<div class="empty-state">Belum ada paket.</div>`}
        </div>
      </div>
      <div class="table-card">
        <div class="toolbar">
          <h3>Soal</h3>
          <button class="btn btn-ghost" data-go="questions">Kelola</button>
        </div>
        <div class="preview-list">
          ${recentQuestions.length ? recentQuestions.map(renderQuestionPreview).join("") : `<div class="empty-state">Belum ada soal.</div>`}
        </div>
      </div>
    </section>

    <section class="section-grid grid-2">
      <div class="table-card">
        <div class="toolbar">
          <h3>${app.profile?.role === "student" ? "Paket yang ditugaskan" : "Attempt terbaru"}</h3>
          <button class="btn btn-ghost" data-go="${app.profile?.role === "student" ? "exams" : "results"}">Buka</button>
        </div>
        <div class="preview-list">
          ${
            app.profile?.role === "student"
              ? assigned.length
                ? assigned.map(renderAssignedPreview).join("")
                : `<div class="empty-state">Belum ada paket yang di-assign.</div>`
              : recentAttempts.length
                ? recentAttempts.map(renderAttemptPreview).join("")
                : `<div class="empty-state">Belum ada attempt.</div>`
          }
        </div>
      </div>
      <div class="table-card">
        <div class="toolbar">
          <h3>Status</h3>
        </div>
        <div class="preview-list">
          <div class="preview-item"><strong>Login</strong><div class="mini-note">OK</div></div>
          <div class="preview-item"><strong>Bank soal</strong><div class="mini-note">OK</div></div>
          <div class="preview-item"><strong>Assignment</strong><div class="mini-note">OK</div></div>
          <div class="preview-item"><strong>Hasil</strong><div class="mini-note">OK</div></div>
        </div>
      </div>
    </section>
  `;
}

function renderPackagePreview(item) {
  const category = findCategoryName(item.category_id);
  return `
    <div class="preview-item">
      <strong>${escapeHtml(item.title)}</strong>
      <div class="mini-note">${escapeHtml(category)} • ${escapeHtml(item.duration_minutes || 0)} menit • passing ${escapeHtml(item.passing_score || 0)}</div>
    </div>`;
}

function renderQuestionPreview(item) {
  const pkg = findPackage(item.package_id);
  return `
    <div class="preview-item">
      <strong>${escapeHtml(item.question_text)}</strong>
      <div class="mini-note">${escapeHtml(pkg?.title || "-")} • Jawaban benar ${escapeHtml(item.correct_option)}</div>
    </div>`;
}

function renderAssignedPreview(item) {
  return `
    <div class="preview-item">
      <strong>${escapeHtml(item.package.title)}</strong>
      <div class="mini-note">Tugas ${item.assigned_to_user ? "siswa" : "kelas"} • ${escapeHtml(item.assigned_to_class || item.assigned_to_user || "-")}</div>
      <div class="toolbar-actions" style="margin-top:10px;">
        <button class="btn btn-primary" data-start-assignment="${item.id}">Mulai</button>
      </div>
    </div>`;
}

function renderAttemptPreview(item) {
  const pkg = findPackage(item.package_id);
  return `
    <div class="preview-item">
      <strong>${escapeHtml(pkg?.title || "Attempt")}</strong>
      <div class="mini-note">Skor ${escapeHtml(item.score || 0)} • ${formatDate(item.submitted_at || item.created_at)}</div>
    </div>`;
}

function renderPackages() {
  const rows = app.data.packages
    .map((item) => {
      const category = findCategoryName(item.category_id);
      return `
        <tr>
          <td><strong>${escapeHtml(item.title)}</strong><div class="subtle">${escapeHtml(item.description || "")}</div></td>
          <td>${escapeHtml(category)}</td>
          <td>${escapeHtml(item.duration_minutes || 0)} menit</td>
          <td>${escapeHtml(item.passing_score || 0)}</td>
          <td>${item.is_published ? '<span class="pill">Published</span>' : '<span class="pill">Draft</span>'}</td>
          <td>
            <button class="btn btn-secondary" data-edit-package="${item.id}">Edit</button>
            <button class="btn btn-danger" data-delete-package="${item.id}">Hapus</button>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <section class="section-card">
      <div class="toolbar">
        <div>
          <p class="page-eyebrow">Paket baru</p>
          <h3 class="page-title" style="font-size:1.3rem;margin-top:0.2rem;">Buat atau perbarui paket ujian</h3>
        </div>
      </div>
      <form id="package-form" class="form-grid cols-2" style="margin-top:16px;">
        <input type="hidden" id="package-id" value="" />
        <label class="field">
          <span class="field-label">Judul paket</span>
          <input id="package-title" required />
        </label>
        <label class="field">
          <span class="field-label">Kategori</span>
          <input id="package-category-name" placeholder="Misalnya: Matematika" required />
        </label>
        <label class="field">
          <span class="field-label">Durasi (menit)</span>
          <input id="package-duration" type="number" min="1" value="60" required />
        </label>
        <label class="field">
          <span class="field-label">Passing score</span>
          <input id="package-passing" type="number" min="0" value="70" required />
        </label>
        <label class="field" style="grid-column:1 / -1;">
          <span class="field-label">Deskripsi</span>
          <textarea id="package-description" rows="3" placeholder="Deskripsi singkat paket"></textarea>
        </label>
        <label class="field" style="grid-column:1 / -1;">
          <span class="field-label">Status publikasi</span>
          <select id="package-published">
            <option value="true">Published</option>
            <option value="false">Draft</option>
          </select>
        </label>
        <div class="toolbar-actions" style="grid-column:1 / -1;">
          <button type="submit" class="btn btn-primary">Simpan paket</button>
          <button type="button" class="btn btn-ghost" id="package-reset">Reset</button>
        </div>
      </form>
    </section>

    <section class="table-card">
      <div class="toolbar">
        <h3>Daftar paket</h3>
        <span class="mini-note">${app.data.packages.length} paket terdata</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Judul</th>
              <th>Kategori</th>
              <th>Durasi</th>
              <th>Passing</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6">Belum ada paket.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderQuestions() {
  const packageOptions = app.data.packages
    .map((item) => `<option value="${item.id}">${escapeHtml(item.title)}</option>`)
    .join("");

  const rows = app.data.questions
    .map((item) => {
      const pkg = findPackage(item.package_id);
      return `
        <tr>
          <td>${escapeHtml(item.order_index || 0)}</td>
          <td><strong>${escapeHtml(item.question_text)}</strong><div class="subtle">${escapeHtml(item.explanation || "")}</div></td>
          <td>${escapeHtml(pkg?.title || "-")}</td>
          <td>${escapeHtml(item.correct_option)}</td>
          <td>${escapeHtml(item.points || 1)}</td>
          <td>
            <button class="btn btn-secondary" data-edit-question="${item.id}">Edit</button>
            <button class="btn btn-danger" data-delete-question="${item.id}">Hapus</button>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <section class="section-card">
      <div class="toolbar">
        <div>
          <p class="page-eyebrow">Soal pilihan ganda</p>
          <h3 class="page-title" style="font-size:1.3rem;margin-top:0.2rem;">Tambah soal ke paket</h3>
        </div>
      </div>
      <form id="question-form" class="form-grid cols-2" style="margin-top:16px;">
        <input type="hidden" id="question-id" value="" />
        <label class="field">
          <span class="field-label">Paket</span>
          <select id="question-package" required>${packageOptions}</select>
        </label>
        <label class="field">
          <span class="field-label">Urutan</span>
          <input id="question-order" type="number" min="1" value="1" />
        </label>
        <label class="field" style="grid-column:1 / -1;">
          <span class="field-label">Pertanyaan</span>
          <textarea id="question-text" rows="4" required></textarea>
        </label>
        <label class="field">
          <span class="field-label">Opsi A</span>
          <input id="question-a" required />
        </label>
        <label class="field">
          <span class="field-label">Opsi B</span>
          <input id="question-b" required />
        </label>
        <label class="field">
          <span class="field-label">Opsi C</span>
          <input id="question-c" required />
        </label>
        <label class="field">
          <span class="field-label">Opsi D</span>
          <input id="question-d" required />
        </label>
        <label class="field">
          <span class="field-label">Jawaban benar</span>
          <select id="question-correct" required>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Poin</span>
          <input id="question-points" type="number" min="1" value="1" />
        </label>
        <label class="field" style="grid-column:1 / -1;">
          <span class="field-label">Pembahasan</span>
          <textarea id="question-explanation" rows="3"></textarea>
        </label>
        <div class="toolbar-actions" style="grid-column:1 / -1;">
          <button type="submit" class="btn btn-primary">Simpan soal</button>
          <button type="button" class="btn btn-ghost" id="question-reset">Reset</button>
        </div>
      </form>
    </section>

    <section class="table-card">
      <div class="toolbar">
        <h3>Daftar soal</h3>
        <span class="mini-note">${app.data.questions.length} soal terdata</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Urutan</th>
              <th>Soal</th>
              <th>Paket</th>
              <th>Benar</th>
              <th>Poin</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6">Belum ada soal.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAssignments() {
  const packageOptions = app.data.packages
    .map((item) => `<option value="${item.id}">${escapeHtml(item.title)}</option>`)
    .join("");
  const userOptions = app.data.profiles
    .filter((item) => item.role === "student")
    .map((item) => `<option value="${item.id}">${escapeHtml(item.username || item.email)}</option>`)
    .join("");

  const rows = app.data.assignments
    .map((item) => {
      const pkg = findPackage(item.package_id);
      return `
        <tr>
          <td><strong>${escapeHtml(pkg?.title || "-")}</strong></td>
          <td>${item.assigned_to_user ? "Siswa" : "Kelas"}</td>
          <td>${escapeHtml(item.assigned_to_user || item.assigned_to_class || "-")}</td>
          <td>${formatDate(item.available_from)}</td>
          <td>${formatDate(item.due_at)}</td>
          <td>${escapeHtml(item.status || "active")}</td>
          <td>
            <button class="btn btn-danger" data-delete-assignment="${item.id}">Hapus</button>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <section class="section-card">
      <div class="toolbar">
        <div>
          <p class="page-eyebrow">Distribusi paket</p>
          <h3 class="page-title" style="font-size:1.3rem;margin-top:0.2rem;">Assign ke siswa atau kelas</h3>
        </div>
      </div>
      <form id="assignment-form" class="form-grid cols-2" style="margin-top:16px;">
        <label class="field">
          <span class="field-label">Paket</span>
          <select id="assignment-package" required>${packageOptions}</select>
        </label>
        <label class="field">
          <span class="field-label">Mode assignment</span>
          <select id="assignment-mode">
            <option value="student">Per siswa</option>
            <option value="class">Per kelas</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Target siswa</span>
          <select id="assignment-user">${userOptions}</select>
        </label>
        <label class="field">
          <span class="field-label">Target kelas</span>
          <input id="assignment-class" placeholder="Contoh: 7A" />
        </label>
        <label class="field">
          <span class="field-label">Tersedia mulai</span>
          <input id="assignment-from" type="datetime-local" />
        </label>
        <label class="field">
          <span class="field-label">Batas waktu</span>
          <input id="assignment-due" type="datetime-local" />
        </label>
        <div class="toolbar-actions" style="grid-column:1 / -1;">
          <button type="submit" class="btn btn-primary">Simpan assignment</button>
        </div>
      </form>
    </section>

    <section class="table-card">
      <div class="toolbar">
        <h3>Daftar assignment</h3>
        <span class="mini-note">${app.data.assignments.length} assignment</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Paket</th>
              <th>Target</th>
              <th>Mulai</th>
              <th>Selesai</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6">Belum ada assignment.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderImport() {
  return `
    <section class="section-grid grid-2">
      <div class="section-card">
        <div class="toolbar">
          <div>
            <h3 class="page-title" style="font-size:1.2rem;margin-top:0.2rem;">Template CSV</h3>
          </div>
        </div>
        <div class="toolbar-actions" style="margin-top:12px;">
          <button class="btn btn-primary" data-download-template>Download CSV template</button>
          <button class="btn btn-secondary" data-download-sample>Download sample CSV</button>
        </div>
      </div>

      <div class="section-card">
        <div class="toolbar">
          <h3 class="page-title" style="font-size:1.2rem;margin-top:0.2rem;">Import CSV</h3>
        </div>
        <form id="import-form" class="form-grid">
          <label class="field">
            <span class="field-label">File CSV</span>
            <input id="import-file" type="file" accept=".csv,text/csv" required />
          </label>
          <div class="toolbar-actions">
            <button type="submit" class="btn btn-primary">Preview dan impor</button>
          </div>
        </form>
      </div>
    </section>

    <section class="table-card">
      <div class="toolbar">
        <h3>Preview</h3>
      </div>
      <div id="import-preview" class="preview-list">
        <div class="empty-state">Belum ada file CSV yang dipilih.</div>
      </div>
    </section>
  `;
}

function renderUsers() {
  const roles = isSuperadmin() ? ["student", "admin", "superadmin"] : ["student", "admin"];
  const rows = app.data.profiles
    .map((item) => {
      const canEditRole = isSuperadmin() || item.role === "student";
      return `
        <tr>
          <td>${escapeHtml(item.username || "-")}</td>
          <td>${escapeHtml(item.email || "-")}</td>
          <td>${escapeHtml(item.class_name || "-")}</td>
          <td>
            <select data-role-user="${item.id}" ${canEditRole ? "" : "disabled"}>
              ${roles
                .map(
                  (role) => `<option value="${role}" ${role === item.role ? "selected" : ""}>${roleLabel(role)}</option>`,
                )
                .join("")}
            </select>
          </td>
          <td>
            <button class="btn btn-secondary" data-save-user="${item.id}">Simpan</button>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <section class="table-card">
      <div class="toolbar">
        <h3>Daftar pengguna</h3>
        <span class="mini-note">${app.data.profiles.length} profil</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Kelas</th>
              <th>Role</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="5">Belum ada profil.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSuperadmin() {
  const settings = settingsMap();
  const logs = app.data.auditLogs.slice(0, 25);
  const adminCount = app.data.profiles.filter((item) => item.role === "admin").length;
  const studentCount = app.data.profiles.filter((item) => item.role === "student").length;
  const superadminCount = app.data.profiles.filter((item) => item.role === "superadmin").length;
  const livePackages = app.data.packages.filter((item) => item.is_published).length;

  const logRows = logs
    .map((log) => {
      const actor = findProfile(log.actor_id);
      return `
        <tr>
          <td>${escapeHtml(log.action)}</td>
          <td>${escapeHtml(log.entity_type)}</td>
          <td>${escapeHtml(log.entity_id || "-")}</td>
          <td>${escapeHtml(actor?.username || actor?.email || "system")}</td>
          <td>${escapeHtml(log.summary || "-")}</td>
          <td>${formatDate(log.created_at)}</td>
        </tr>`;
    })
    .join("");

  return `
    <section class="section-grid grid-3">
      <div class="score-box"><span class="subtle">Superadmin</span><strong>${superadminCount}</strong></div>
      <div class="score-box"><span class="subtle">Admin</span><strong>${adminCount}</strong></div>
      <div class="score-box"><span class="subtle">Student</span><strong>${studentCount}</strong></div>
    </section>

    <section class="section-grid grid-2">
      <div class="section-card">
        <div class="toolbar">
          <div>
            <h3 class="page-title" style="font-size:1.2rem;margin-top:0.2rem;">Settings</h3>
          </div>
        </div>
        <form id="superadmin-settings-form" class="form-grid cols-2" style="margin-top:16px;">
          <label class="field" style="grid-column:1 / -1;">
            <span class="field-label">Nama aplikasi</span>
            <input id="setting-app-name" value="${escapeHtml(settings.app_name || "Bimbel Juara CBT")}" />
          </label>
          <label class="field">
            <span class="field-label">Maintenance mode</span>
            <select id="setting-maintenance">
              <option value="true" ${boolSetting("maintenance_mode") ? "selected" : ""}>True</option>
              <option value="false" ${!boolSetting("maintenance_mode") ? "selected" : ""}>False</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Default durasi (menit)</span>
            <input id="setting-default-duration" type="number" min="1" value="${escapeHtml(numberSetting("default_exam_duration_minutes", 60))}" />
          </label>
          <label class="field">
            <span class="field-label">Default passing score</span>
            <input id="setting-default-passing" type="number" min="0" value="${escapeHtml(numberSetting("default_passing_score", 70))}" />
          </label>
          <label class="field" style="grid-column:1 / -1;">
            <span class="field-label">Announcement</span>
            <textarea id="setting-announcement" rows="3">${escapeHtml(settings.announcement || "")}</textarea>
          </label>
          <div class="toolbar-actions" style="grid-column:1 / -1;">
            <button type="submit" class="btn btn-primary">Simpan settings</button>
            <button type="button" class="btn btn-ghost" data-superadmin-refresh>Refresh data</button>
          </div>
        </form>
      </div>

      <div class="section-card">
        <div class="toolbar">
          <div>
            <h3 class="page-title" style="font-size:1.2rem;margin-top:0.2rem;">Profile shell</h3>
          </div>
        </div>
        <form id="superadmin-profile-form" class="form-grid cols-2" style="margin-top:16px;">
          <label class="field">
            <span class="field-label">Auth user id</span>
            <input id="super-profile-id" placeholder="uuid auth.users" required />
          </label>
          <label class="field">
            <span class="field-label">Email</span>
            <input id="super-profile-email" type="email" placeholder="user@email.com" required />
          </label>
          <label class="field">
            <span class="field-label">Username</span>
            <input id="super-profile-username" placeholder="misalnya: budi" required />
          </label>
          <label class="field">
            <span class="field-label">Role</span>
            <select id="super-profile-role">
              <option value="student">Student</option>
              <option value="admin">Admin</option>
              <option value="superadmin">Superadmin</option>
            </select>
          </label>
          <label class="field" style="grid-column:1 / -1;">
            <span class="field-label">Class name</span>
            <input id="super-profile-class" placeholder="contoh: 8A" />
          </label>
          <div class="toolbar-actions" style="grid-column:1 / -1;">
            <button type="submit" class="btn btn-primary">Simpan profile shell</button>
          </div>
        </form>
      </div>
    </section>

    <section class="section-grid grid-2">
      <div class="table-card">
        <div class="toolbar">
          <h3>System snapshot</h3>
          <span class="mini-note">Published package: ${livePackages}</span>
        </div>
        <div class="preview-list">
          <div class="preview-item">
            <strong>App name</strong>
            <div class="mini-note">${escapeHtml(settings.app_name || "-")}</div>
          </div>
          <div class="preview-item">
            <strong>Maintenance</strong>
            <div class="mini-note">${boolSetting("maintenance_mode") ? "ON" : "OFF"}</div>
          </div>
          <div class="preview-item">
            <strong>Default duration</strong>
            <div class="mini-note">${escapeHtml(numberSetting("default_exam_duration_minutes", 60))} menit</div>
          </div>
          <div class="preview-item">
            <strong>Default passing score</strong>
            <div class="mini-note">${escapeHtml(numberSetting("default_passing_score", 70))}</div>
          </div>
        </div>
      </div>

      <div class="table-card">
        <div class="toolbar">
          <h3>Audit log</h3>
          <span class="mini-note">${logs.length} event terakhir</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Aksi</th>
                <th>Tipe</th>
                <th>Entity</th>
                <th>Actor</th>
                <th>Ringkasan</th>
                <th>Waktu</th>
              </tr>
            </thead>
            <tbody>${logRows || `<tr><td colspan="6">Belum ada audit log.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function renderExams() {
  const assigned = assignedPackagesForCurrentUser();

  return `
    <section class="section-card">
      <div class="toolbar">
        <div>
          <p class="page-eyebrow">Ujian aktif</p>
          <h3 class="page-title" style="font-size:1.3rem;margin-top:0.2rem;">Paket yang di-assign untuk Anda</h3>
        </div>
      </div>
      <div class="preview-list" style="margin-top:16px;">
        ${
          assigned.length
            ? assigned
                .map(
                  (assignment) => `
                    <div class="preview-item">
                      <strong>${escapeHtml(assignment.package.title)}</strong>
                      <div class="mini-note">${escapeHtml(assignment.package.description || "")}</div>
                      <div class="mini-note">Durasi ${escapeHtml(assignment.package.duration_minutes || 0)} menit • Passing ${escapeHtml(assignment.package.passing_score || 0)}</div>
                      <div class="toolbar-actions" style="margin-top:10px;">
                        <button class="btn btn-primary" data-start-assignment="${assignment.id}">Mulai ujian</button>
                      </div>
                    </div>`,
                )
                .join("")
            : `<div class="empty-state">Belum ada assignment untuk akun ini.</div>`
        }
      </div>
    </section>
  `;
}

function renderResults() {
  const attempts = isAdminLike()
    ? app.data.attempts
    : app.data.attempts.filter((item) => item.user_id === app.user.id);

  const total = attempts.length;
  const completed = attempts.filter((item) => item.status === "submitted").length;
  const avgScore = total
    ? Math.round(attempts.reduce((sum, item) => sum + Number(item.score || 0), 0) / total)
    : 0;
  const best = attempts.reduce((max, item) => Math.max(max, Number(item.score || 0)), 0);

  const rows = attempts
    .map((item) => {
      const pkg = findPackage(item.package_id);
      const user = findProfile(item.user_id);
      return `
        <tr>
          <td>${escapeHtml(pkg?.title || "-")}</td>
          <td>${escapeHtml(user?.username || user?.email || "-")}</td>
          <td>${escapeHtml(item.correct_count || 0)} / ${escapeHtml(item.total_questions || 0)}</td>
          <td>${escapeHtml(item.score || 0)}</td>
          <td>${escapeHtml(item.status || "-")}</td>
          <td>${formatDate(item.submitted_at || item.created_at)}</td>
          <td><button class="btn btn-secondary" data-view-attempt="${item.id}">Detail</button></td>
        </tr>`;
    })
    .join("");

  return `
    <section class="section-grid grid-3">
      <div class="score-box"><span class="subtle">Attempt total</span><strong>${total}</strong></div>
      <div class="score-box"><span class="subtle">Completed</span><strong>${completed}</strong></div>
      <div class="score-box"><span class="subtle">Rata-rata skor</span><strong>${avgScore}</strong></div>
    </section>

    <section class="section-card">
      <div class="toolbar">
        <h3>${isAdminLike() ? "Analisis hasil" : "Riwayat saya"}</h3>
        <span class="mini-note">Skor terbaik: ${best}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Paket</th>
              <th>Peserta</th>
              <th>Benar</th>
              <th>Skor</th>
              <th>Status</th>
              <th>Waktu</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="7">Belum ada hasil.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderExam() {
  if (!app.exam) {
    return `<section class="section-card"><div class="empty-state">Belum ada ujian aktif.</div></section>`;
  }

  if (app.exam.completed && app.exam.result) {
    return renderExamResult();
  }

  const meta = findPackage(app.exam.packageId);
  const timerText = app.exam.timeLeft <= 0 ? "Waktu habis" : `${formatDuration(app.exam.timeLeft)}`;
  const questionHtml = app.exam.questions
    .map((item, index) => {
      const selected = app.exam.answers[item.id] || "";
      return `
        <div class="question-card">
          <strong>${index + 1}. ${escapeHtml(item.question_text)}</strong>
          <div class="option-list">
            ${renderOption(item, "A", selected)}
            ${renderOption(item, "B", selected)}
            ${renderOption(item, "C", selected)}
            ${renderOption(item, "D", selected)}
          </div>
        </div>`;
    })
    .join("");

  return `
    <section class="exam-card">
      <div class="timer-badge">Timer: <span id="exam-timer">${escapeHtml(timerText)}</span></div>
      <div class="toolbar">
        <div>
          <h3 class="page-title" style="font-size:1.4rem;margin-top:0.2rem;">${escapeHtml(meta?.title || "Paket")}</h3>
        </div>
        <div class="toolbar-actions">
          <button class="btn btn-primary" id="submit-exam-button">Kirim jawaban</button>
        </div>
      </div>
      <div style="margin-top:16px;">
        ${questionHtml || `<div class="empty-state">Tidak ada soal di paket ini.</div>`}
      </div>
    </section>
  `;
}

function renderOption(question, key, selected) {
  return `
    <label class="option">
      <input type="radio" name="question-${question.id}" value="${key}" ${selected === key ? "checked" : ""} />
      <span><strong>${key}.</strong> ${escapeHtml(question[`option_${key.toLowerCase()}`])}</span>
    </label>`;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function bindCurrentView() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.view));
  });

  document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.go));
  });

  document.querySelectorAll("[data-start-assignment]").forEach((button) => {
    button.addEventListener("click", () => startAssignment(button.dataset.startAssignment));
  });

  document.querySelectorAll("[data-edit-package]").forEach((button) => {
    button.addEventListener("click", () => editPackage(button.dataset.editPackage));
  });

  document.querySelectorAll("[data-delete-package]").forEach((button) => {
    button.addEventListener("click", () => removePackage(button.dataset.deletePackage));
  });

  document.querySelectorAll("[data-edit-question]").forEach((button) => {
    button.addEventListener("click", () => editQuestion(button.dataset.editQuestion));
  });

  document.querySelectorAll("[data-delete-question]").forEach((button) => {
    button.addEventListener("click", () => removeQuestion(button.dataset.deleteQuestion));
  });

  document.querySelectorAll("[data-delete-assignment]").forEach((button) => {
    button.addEventListener("click", () => removeAssignment(button.dataset.deleteAssignment));
  });

  document.querySelectorAll("[data-save-user]").forEach((button) => {
    button.addEventListener("click", () => saveUserProfile(button.dataset.saveUser));
  });

  document.querySelectorAll("[data-view-attempt]").forEach((button) => {
    button.addEventListener("click", () => showAttemptDetail(button.dataset.viewAttempt));
  });

  document.querySelectorAll("[data-download-template]").forEach((button) => {
    button.addEventListener("click", downloadCsvTemplate);
  });

  document.querySelectorAll("[data-download-sample]").forEach((button) => {
    button.addEventListener("click", () =>
      downloadTextFile("template-soal.csv", CSV_TEMPLATE, "text/csv;charset=utf-8"),
    );
  });

  const modal = $("modal");
  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
  }

  const logoutButton = $("logout-button");
  if (logoutButton) {
    logoutButton.addEventListener("click", logout);
  }

  bindForms();

  if (app.view === "exam") {
    bindExamActions();
  }

  if (app.view === "import") {
    bindImportActions();
  }
}

function bindForms() {
  const packageForm = $("package-form");
  if (packageForm) {
    packageForm.addEventListener("submit", savePackage);
    const reset = $("package-reset");
    if (reset) {
      reset.addEventListener("click", resetPackageForm);
    }
  }

  const questionForm = $("question-form");
  if (questionForm) {
    questionForm.addEventListener("submit", saveQuestion);
    const reset = $("question-reset");
    if (reset) {
      reset.addEventListener("click", resetQuestionForm);
    }
  }

  const assignmentForm = $("assignment-form");
  if (assignmentForm) {
    assignmentForm.addEventListener("submit", saveAssignment);
    const mode = $("assignment-mode");
    const targetUser = $("assignment-user");
    const targetClass = $("assignment-class");
    const toggleTarget = () => {
      const selected = mode?.value || "student";
      if (targetUser) targetUser.closest("label").style.display = selected === "student" ? "grid" : "none";
      if (targetClass) targetClass.closest("label").style.display = selected === "class" ? "grid" : "none";
    };
    if (mode) {
      mode.addEventListener("change", toggleTarget);
      toggleTarget();
    }
  }

  const importForm = $("import-form");
  if (importForm) {
    importForm.addEventListener("submit", handleImportSubmit);
  }

  const superadminSettingsForm = $("superadmin-settings-form");
  if (superadminSettingsForm) {
    superadminSettingsForm.addEventListener("submit", saveSuperadminSettings);
  }

  const superadminProfileForm = $("superadmin-profile-form");
  if (superadminProfileForm) {
    superadminProfileForm.addEventListener("submit", saveSuperadminProfileShell);
  }

  const superadminRefresh = document.querySelector("[data-superadmin-refresh]");
  if (superadminRefresh) {
    superadminRefresh.addEventListener("click", async () => {
      toast("Menyegarkan data...", "info");
      await refreshData();
    });
  }
}

function bindImportActions() {
  const input = $("import-file");
  if (!input) return;
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const records = csvToObjects(text);
    renderImportPreview(records.slice(0, 20));
  });
}

function bindExamActions() {
  const submitButton = $("submit-exam-button");
  if (submitButton) {
    submitButton.addEventListener("click", submitExam);
  }
}

function renderImportPreview(records) {
  const preview = $("import-preview");
  if (!preview) return;
  if (!records.length) {
    preview.innerHTML = `<div class="empty-state">CSV tidak memiliki data yang bisa diproses.</div>`;
    return;
  }
  preview.innerHTML = records
    .map(
      (row, index) => `
        <div class="preview-item">
          <strong>Row ${index + 1}</strong>
          <div class="mini-note">${escapeHtml(row.question_text || "-")}</div>
          <div class="mini-note">${escapeHtml(row.package_title || "-")} • ${escapeHtml(row.category_name || "-")} • jawaban ${escapeHtml(row.correct_option || "-")}</div>
        </div>`,
    )
    .join("");
}

function downloadCsvTemplate() {
  downloadTextFile("template-soal.csv", CSV_TEMPLATE, "text/csv;charset=utf-8");
}

async function bootstrap() {
  if ($("login-form")) {
    bindLoginPage();
  }

  if ($("dashboard-page") || $("sidebar-nav")) {
    await ensureSessionOnDashboard();
  } else if ($("login-form")) {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    if (session) {
      window.location.href = "dashboard.html";
    }
  }
}

function bindLoginPage() {
  const form = $("login-form");
  const message = $("login-message");
  if (!form || !message) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";

    const email = $("email")?.value.trim() || "";
    const password = $("password")?.value || "";

    if (!email || !password) {
      message.innerHTML = '<span class="status-bad">Email dan password wajib diisi.</span>';
      return;
    }

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      message.innerHTML = `<span class="status-bad">${escapeHtml(error.message)}</span>`;
      return;
    }

    message.innerHTML = '<span class="status-good">Login berhasil. Mengalihkan...</span>';
    setTimeout(() => {
      window.location.href = "dashboard.html";
    }, 700);
  });
}

async function ensureSessionOnDashboard() {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (!session) {
    window.location.href = "index.html";
    return;
  }

  app.session = session;
  app.user = session.user;
  await loadProfile();
  await refreshData();
  app.view = app.profile?.role === "student" ? "overview" : "overview";
  renderShell();
}

async function loadProfile() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", app.user.id)
    .maybeSingle();

  if (data) {
    app.profile = data;
    await touchProfileLogin();
    return;
  }

  if (error && error.code !== "PGRST116") {
    app.setupWarnings.push(`profiles: ${error.message}`);
  }

  const fallback = {
    id: app.user.id,
    email: app.user.email,
    username: (app.user.email || "user").split("@")[0],
    role: "student",
  };

  const { data: inserted, error: insertError } = await supabaseClient
    .from("profiles")
    .insert(fallback)
    .select("*")
    .single();

  if (inserted) {
    app.profile = inserted;
    await touchProfileLogin();
    return;
  }

  if (insertError) {
    app.setupWarnings.push(`profiles insert: ${insertError.message}`);
  }

  app.profile = fallback;
  await touchProfileLogin();
}

async function touchProfileLogin() {
  if (!app.user?.id) return;
  await supabaseClient
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", app.user.id);
}

async function savePackage(event) {
  event.preventDefault();
  const id = $("package-id")?.value || "";
  const title = $("package-title")?.value.trim();
  const categoryName = $("package-category-name")?.value.trim();
  const durationMinutes = Number($("package-duration")?.value || 0);
  const passingScore = Number($("package-passing")?.value || 0);
  const description = $("package-description")?.value.trim() || null;
  const isPublished = $("package-published")?.value === "true";

  if (!title || !categoryName) {
    toast("Judul paket dan kategori wajib diisi.", "error");
    return;
  }

  const categoryId = await ensureCategory(categoryName);
  if (!categoryId) return;

  const payload = {
    title,
    category_id: categoryId,
    duration_minutes: durationMinutes,
    passing_score: passingScore,
    description,
    is_published: isPublished,
    created_by: app.user.id,
  };

  const builder = id
    ? supabaseClient.from("question_packages").update(payload).eq("id", id)
    : supabaseClient.from("question_packages").insert(payload);

  const { error } = await builder;
  if (error) {
    toast(error.message, "error");
    return;
  }

  await logAudit(
    id ? "update_package" : "create_package",
    "question_packages",
    id || "new",
    `Paket ${id ? "diperbarui" : "dibuat"}: ${title}`,
    { categoryId, durationMinutes, passingScore, isPublished },
  );

  toast(id ? "Paket berhasil diperbarui." : "Paket berhasil dibuat.", "success");
  resetPackageForm();
  await refreshData();
}

async function ensureCategory(name) {
  const existing = app.data.categories.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing.id;

  const { data, error } = await supabaseClient
    .from("categories")
    .insert({ name })
    .select("*")
    .single();

  if (error) {
    toast(error.message, "error");
    return null;
  }

  app.data.categories.unshift(data);
  return data.id;
}

function resetPackageForm() {
  $("package-id").value = "";
  $("package-title").value = "";
  $("package-category-name").value = "";
  $("package-duration").value = 60;
  $("package-passing").value = 70;
  $("package-description").value = "";
  $("package-published").value = "true";
}

function editPackage(id) {
  const item = app.data.packages.find((row) => String(row.id) === String(id));
  if (!item) return;
  $("package-id").value = item.id;
  $("package-title").value = item.title || "";
  $("package-category-name").value = findCategoryName(item.category_id) || "";
  $("package-duration").value = item.duration_minutes || 60;
  $("package-passing").value = item.passing_score || 70;
  $("package-description").value = item.description || "";
  $("package-published").value = String(Boolean(item.is_published));
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("Paket siap diedit.", "info");
}

async function removePackage(id) {
  if (!confirm("Hapus paket ini? Semua soal terkait tetap harus ditangani manual.")) return;
  const { error } = await supabaseClient.from("question_packages").delete().eq("id", id);
  if (error) {
    toast(error.message, "error");
    return;
  }

  await logAudit("delete_package", "question_packages", id, "Paket dihapus");
  toast("Paket dihapus.", "success");
  await refreshData();
}

async function saveQuestion(event) {
  event.preventDefault();
  const id = $("question-id")?.value || "";
  const packageId = $("question-package")?.value;
  const questionText = $("question-text")?.value.trim();
  const optionA = $("question-a")?.value.trim();
  const optionB = $("question-b")?.value.trim();
  const optionC = $("question-c")?.value.trim();
  const optionD = $("question-d")?.value.trim();
  const correctOption = $("question-correct")?.value;
  const explanation = $("question-explanation")?.value.trim() || null;
  const orderIndex = Number($("question-order")?.value || 1);
  const points = Number($("question-points")?.value || 1);
  const packageItem = findPackage(packageId);

  if (!packageId || !questionText || !optionA || !optionB || !optionC || !optionD || !correctOption) {
    toast("Semua field utama soal wajib diisi.", "error");
    return;
  }

  const payload = {
    package_id: packageId,
    category_id: packageItem?.category_id || null,
    question_text: questionText,
    option_a: optionA,
    option_b: optionB,
    option_c: optionC,
    option_d: optionD,
    correct_option: correctOption,
    explanation,
    points,
    order_index: orderIndex,
    created_by: app.user.id,
  };

  const builder = id
    ? supabaseClient.from("questions").update(payload).eq("id", id)
    : supabaseClient.from("questions").insert(payload);

  const { error } = await builder;
  if (error) {
    toast(error.message, "error");
    return;
  }

  await logAudit(
    id ? "update_question" : "create_question",
    "questions",
    id || "new",
    `${id ? "Soal diperbarui" : "Soal dibuat"}: ${questionText.slice(0, 80)}`,
    { packageId, correctOption, points, orderIndex },
  );

  toast(id ? "Soal diperbarui." : "Soal berhasil ditambahkan.", "success");
  resetQuestionForm();
  await refreshData();
}

function resetQuestionForm() {
  $("question-id").value = "";
  if (app.data.packages[0]) $("question-package").value = app.data.packages[0].id;
  $("question-order").value = 1;
  $("question-text").value = "";
  $("question-a").value = "";
  $("question-b").value = "";
  $("question-c").value = "";
  $("question-d").value = "";
  $("question-correct").value = "A";
  $("question-points").value = 1;
  $("question-explanation").value = "";
}

function editQuestion(id) {
  const item = app.data.questions.find((row) => String(row.id) === String(id));
  if (!item) return;
  $("question-id").value = item.id;
  $("question-package").value = item.package_id;
  $("question-order").value = item.order_index || 1;
  $("question-text").value = item.question_text || "";
  $("question-a").value = item.option_a || "";
  $("question-b").value = item.option_b || "";
  $("question-c").value = item.option_c || "";
  $("question-d").value = item.option_d || "";
  $("question-correct").value = item.correct_option || "A";
  $("question-points").value = item.points || 1;
  $("question-explanation").value = item.explanation || "";
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("Soal siap diedit.", "info");
}

async function removeQuestion(id) {
  if (!confirm("Hapus soal ini?")) return;
  const { error } = await supabaseClient.from("questions").delete().eq("id", id);
  if (error) {
    toast(error.message, "error");
    return;
  }
  await logAudit("delete_question", "questions", id, "Soal dihapus");
  toast("Soal dihapus.", "success");
  await refreshData();
}

async function saveAssignment(event) {
  event.preventDefault();
  const packageId = $("assignment-package")?.value;
  const mode = $("assignment-mode")?.value;
  const assignedToUser = mode === "student" ? $("assignment-user")?.value : null;
  const assignedToClass = mode === "class" ? $("assignment-class")?.value.trim() : null;
  const availableFrom = $("assignment-from")?.value || null;
  const dueAt = $("assignment-due")?.value || null;

  if (!packageId) {
    toast("Pilih paket terlebih dahulu.", "error");
    return;
  }

  if (mode === "student" && !assignedToUser) {
    toast("Pilih siswa tujuan.", "error");
    return;
  }

  if (mode === "class" && !assignedToClass) {
    toast("Isi nama kelas tujuan.", "error");
    return;
  }

  const { error } = await supabaseClient.from("assignments").insert({
    package_id: packageId,
    assigned_to_user: assignedToUser || null,
    assigned_to_class: assignedToClass || null,
    available_from: availableFrom || null,
    due_at: dueAt || null,
    status: "active",
    assigned_by: app.user.id,
  });

  if (error) {
    toast(error.message, "error");
    return;
  }

  await logAudit(
    "create_assignment",
    "assignments",
    "new",
    "Assignment baru dibuat",
    { packageId, assignedToUser, assignedToClass, availableFrom, dueAt },
  );

  toast("Assignment tersimpan.", "success");
  await refreshData();
}

async function removeAssignment(id) {
  if (!confirm("Hapus assignment ini?")) return;
  const { error } = await supabaseClient.from("assignments").delete().eq("id", id);
  if (error) {
    toast(error.message, "error");
    return;
  }
  await logAudit("delete_assignment", "assignments", id, "Assignment dihapus");
  toast("Assignment dihapus.", "success");
  await refreshData();
}

async function saveUserProfile(userId) {
  const roleSelect = document.querySelector(`[data-role-user="${userId}"]`);
  if (!roleSelect) return;
  const role = roleSelect.value;

  const { error } = await supabaseClient
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) {
    toast(error.message, "error");
    return;
  }

  toast("Profil diperbarui.", "success");
  await logAudit("update_profile_role", "profiles", userId, `Role diubah menjadi ${role}`, { role });
  await refreshData();
}

async function saveSuperadminSettings(event) {
  event.preventDefault();

  const entries = [
    ["app_name", $("setting-app-name")?.value.trim() || "Bimbel Juara CBT"],
    ["maintenance_mode", $("setting-maintenance")?.value || "false"],
    ["default_exam_duration_minutes", String(Number($("setting-default-duration")?.value || 60))],
    ["default_passing_score", String(Number($("setting-default-passing")?.value || 70))],
    ["announcement", $("setting-announcement")?.value.trim() || ""],
  ];

  for (const [key, value] of entries) {
    const { error } = await supabaseClient
      .from("system_settings")
      .upsert({ key, value, updated_by: app.user.id }, { onConflict: "key" });

    if (error) {
      toast(error.message, "error");
      return;
    }
  }

  await logAudit("update_system_settings", "system_settings", "global", "Settings global diperbarui", {
    settings: Object.fromEntries(entries),
  });

  toast("Settings global tersimpan.", "success");
  await refreshData();
}

async function saveSuperadminProfileShell(event) {
  event.preventDefault();

  const id = $("super-profile-id")?.value.trim();
  const email = $("super-profile-email")?.value.trim();
  const username = $("super-profile-username")?.value.trim();
  const role = $("super-profile-role")?.value || "student";
  const className = $("super-profile-class")?.value.trim() || null;

  if (!id || !email || !username) {
    toast("Auth user id, email, dan username wajib diisi.", "error");
    return;
  }

  const payload = {
    id,
    email,
    username,
    role,
    class_name: className,
    is_active: true,
    last_login_at: null,
  };

  const { error } = await supabaseClient.from("profiles").upsert(payload);
  if (error) {
    toast(error.message, "error");
    return;
  }

  await logAudit("upsert_profile_shell", "profiles", id, `Profile shell ${username} disimpan`, {
    email,
    username,
    role,
    class_name: className,
  });

  toast("Profile shell tersimpan.", "success");
  await refreshData();
}

async function logAudit(action, entityType, entityId, summary, metadata = {}) {
  if (!isAdminLike() && !isSuperadmin()) return;
  const { error } = await supabaseClient.from("audit_logs").insert({
    actor_id: app.user.id,
    action,
    entity_type: entityType,
    entity_id: String(entityId ?? ""),
    summary,
    metadata,
  });
  if (error) {
    console.warn("Audit log failed:", error.message);
  }
}

async function ensureExamAssignment(assignmentId) {
  const assignment = app.data.assignments.find((item) => String(item.id) === String(assignmentId));
  if (!assignment) return null;
  const pkg = findPackage(assignment.package_id);
  if (!pkg) return null;

  const { data, error } = await supabaseClient
    .from("attempts")
    .insert({
      assignment_id: assignment.id,
      package_id: pkg.id,
      user_id: app.user.id,
      started_at: new Date().toISOString(),
      status: "in_progress",
      total_questions: app.data.questions.filter((item) => String(item.package_id) === String(pkg.id)).length,
    })
    .select("*")
    .single();

  if (error) {
    toast(error.message, "error");
    return null;
  }

  const questions = app.data.questions
    .filter((item) => String(item.package_id) === String(pkg.id))
    .sort((a, b) => Number(a.order_index || 0) - Number(b.order_index || 0));

  app.exam = {
    attempt: data,
    assignment,
    package: pkg,
    questions,
    answers: {},
    timeLeft: Number(pkg.duration_minutes || 60) * 60,
    completed: false,
    result: null,
  };

  navigate("exam");
  startExamTimer();
  renderShell();
  return data;
}

async function startAssignment(assignmentId) {
  const assignment = app.data.assignments.find((item) => String(item.id) === String(assignmentId));
  if (!assignment) return;
  if (app.profile?.role !== "student") {
    toast("Hanya student yang bisa memulai ujian dari assignment ini.", "error");
    return;
  }

  if (app.exam?.timer) {
    clearInterval(app.exam.timer);
  }

  await ensureExamAssignment(assignmentId);
}

function startExamTimer() {
  if (!app.exam) return;
  if (app.exam.timer) clearInterval(app.exam.timer);
  app.exam.timer = setInterval(() => {
    app.exam.timeLeft -= 1;
    const timer = $("exam-timer");
    if (timer) timer.textContent = formatDuration(app.exam.timeLeft);
    if (app.exam.timeLeft <= 0) {
      clearInterval(app.exam.timer);
      submitExam();
    }
  }, 1000);
}

function collectExamAnswers() {
  if (!app.exam) return {};
  const answers = {};
  app.exam.questions.forEach((question) => {
    const selected = document.querySelector(`input[name="question-${question.id}"]:checked`);
    if (selected) {
      answers[question.id] = selected.value;
    }
  });
  return answers;
}

async function submitExam() {
  if (!app.exam || app.exam.completed) return;

  const answers = collectExamAnswers();
  let correctCount = 0;
  let totalScore = 0;
  const answerRows = [];

  app.exam.questions.forEach((question) => {
    const selected = answers[question.id] || null;
    const isCorrect = selected && selected === question.correct_option;
    if (isCorrect) {
      correctCount += 1;
      totalScore += Number(question.points || 1);
    }
    answerRows.push({
      attempt_id: app.exam.attempt.id,
      question_id: question.id,
      selected_option: selected,
      is_correct: Boolean(isCorrect),
      points_awarded: isCorrect ? Number(question.points || 1) : 0,
    });
  });

  const { error: answersError } = await supabaseClient.from("attempt_answers").insert(answerRows);
  if (answersError) {
    toast(answersError.message, "error");
    return;
  }

  const { error: updateError } = await supabaseClient
    .from("attempts")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      correct_count: correctCount,
      score: totalScore,
      total_questions: app.exam.questions.length,
    })
    .eq("id", app.exam.attempt.id);

  if (updateError) {
    toast(updateError.message, "error");
    return;
  }

  if (app.exam.timer) clearInterval(app.exam.timer);

  app.exam.completed = true;
  app.exam.result = {
    correctCount,
    totalScore,
    totalQuestions: app.exam.questions.length,
  };

  app.exam.answers = answers;
  await logAudit("submit_attempt", "attempts", app.exam.attempt.id, "Siswa mengumpulkan ujian", {
    packageId: app.exam.package.id,
    correctCount,
    totalQuestions: app.exam.questions.length,
    score: totalScore,
  });
  await refreshData();
  navigate("exam");
  renderShell();
}

function renderExamResult() {
  if (!app.exam || !app.exam.result) return;
  return `
    <section class="result-card" style="margin-top:16px;">
      <div class="toolbar">
        <div>
          <p class="page-eyebrow">Hasil ujian</p>
          <h3 class="page-title" style="font-size:1.4rem;margin-top:0.2rem;">Skor: ${escapeHtml(app.exam.result.totalScore)}</h3>
        </div>
        <div class="toolbar-actions">
          <button class="btn btn-primary" data-go="results">Lihat riwayat</button>
          <button class="btn btn-secondary" data-go="exams">Kembali ke ujian</button>
        </div>
      </div>
      <div class="result-summary" style="margin-top:16px;">
        <div class="score-box"><span class="subtle">Benar</span><strong>${app.exam.result.correctCount}</strong></div>
        <div class="score-box"><span class="subtle">Total soal</span><strong>${app.exam.result.totalQuestions}</strong></div>
        <div class="score-box"><span class="subtle">Skor akhir</span><strong>${app.exam.result.totalScore}</strong></div>
      </div>
      <div style="margin-top:18px;" class="preview-list">
        ${app.exam.questions
          .map((question, index) => {
            const selected = app.exam.answers[question.id] || "-";
            const correct = question.correct_option;
            const status = selected === correct ? "status-good" : "status-bad";
            return `
              <div class="preview-item">
                <strong>${index + 1}. ${escapeHtml(question.question_text)}</strong>
                <div class="mini-note">Jawaban Anda: ${escapeHtml(selected)} • Benar: ${escapeHtml(correct)} <span class="${status}">(${selected === correct ? "Benar" : "Salah"})</span></div>
                <div class="mini-note">${escapeHtml(question.explanation || "Tidak ada pembahasan.")}</div>
              </div>`;
          })
          .join("")}
      </div>
    </section>`;
}

function showAttemptDetail(id) {
  const attempt = app.data.attempts.find((item) => String(item.id) === String(id));
  if (!attempt) return;
  const pkg = findPackage(attempt.package_id);
  const user = findProfile(attempt.user_id);
  openModal(`
    <div class="modal-header">
      <div>
        <p class="page-eyebrow">Detail attempt</p>
        <h3 class="page-title" style="font-size:1.3rem;margin-top:0.2rem;">${escapeHtml(pkg?.title || "-")}</h3>
      </div>
      <button class="btn btn-ghost" onclick="closeModal()">Tutup</button>
    </div>
    <div class="preview-list">
      <div class="preview-item">Peserta: <strong>${escapeHtml(user?.username || user?.email || "-")}</strong></div>
      <div class="preview-item">Skor: <strong>${escapeHtml(attempt.score || 0)}</strong></div>
      <div class="preview-item">Benar: <strong>${escapeHtml(attempt.correct_count || 0)} / ${escapeHtml(attempt.total_questions || 0)}</strong></div>
      <div class="preview-item">Status: <strong>${escapeHtml(attempt.status || "-")}</strong></div>
    </div>
  `);
}

async function handleImportSubmit(event) {
  event.preventDefault();
  const file = $("import-file")?.files?.[0];
  if (!file) {
    toast("Pilih file CSV terlebih dahulu.", "error");
    return;
  }

  const text = await file.text();
  const records = csvToObjects(text).filter((row) => row.question_text || row.package_title);
  if (!records.length) {
    toast("CSV kosong atau format tidak valid.", "error");
    return;
  }

  renderImportPreview(records.slice(0, 20));

  const shouldContinue = confirm(`Impor ${records.length} baris soal sekarang?`);
  if (!shouldContinue) return;

  let inserted = 0;
  for (const row of records) {
    const categoryId = await ensureCategory(row.category_name || "Umum");
    if (!categoryId) continue;
    const packageId = await ensurePackage(row.package_title, categoryId);
    if (!packageId) continue;

    const payload = {
      package_id: packageId,
      category_id: categoryId,
      question_text: row.question_text,
      option_a: row.option_a,
      option_b: row.option_b,
      option_c: row.option_c,
      option_d: row.option_d,
      correct_option: String(row.correct_option || "").trim().toUpperCase(),
      explanation: row.explanation || null,
      points: Number(row.points || 1),
      order_index: Number(row.order_index || inserted + 1),
      created_by: app.user.id,
    };

    const { error } = await supabaseClient.from("questions").insert(payload);
    if (!error) inserted += 1;
  }

  toast(`Impor selesai. ${inserted} soal berhasil ditambahkan.`, "success");
  await refreshData();
}

async function ensurePackage(title, categoryId) {
  const existing = app.data.packages.find(
    (item) => item.title.toLowerCase() === String(title || "").toLowerCase(),
  );
  if (existing) return existing.id;

  const { data, error } = await supabaseClient
    .from("question_packages")
    .insert({
      title,
      category_id: categoryId,
      duration_minutes: 60,
      passing_score: 70,
      is_published: false,
      created_by: app.user.id,
    })
    .select("*")
    .single();

  if (error) {
    toast(error.message, "error");
    return null;
  }

  app.data.packages.unshift(data);
  return data.id;
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
}

window.navigate = navigate;
window.editPackage = editPackage;
window.editQuestion = editQuestion;
window.removePackage = removePackage;
window.removeQuestion = removeQuestion;
window.removeAssignment = removeAssignment;
window.startAssignment = startAssignment;
window.submitExam = submitExam;
window.closeModal = closeModal;

bootstrap();
