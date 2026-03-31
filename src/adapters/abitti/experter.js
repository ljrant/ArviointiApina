function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvEscape(value) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadTextFile(filename, text, mimeType = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function getExamId() {
  const match = window.location.pathname.match(/^\/school\/grading\/([a-f0-9-]+)/i);
  return match ? match[1] : "unknown-exam";
}

function getQuestionHeaders() {
  return [
    ...document.querySelectorAll("#scoreTable thead tr.questionNumberRow th")
  ];
}

function getQuestionOrder() {
  return getQuestionHeaders()
    .map((th) => {
      const wrapper = th.querySelector(".wrapper");
      if (!wrapper) return null;

      const textNode = [...wrapper.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE
      );

      const label = (textNode?.textContent || "").trim();

      if (!label) return null;
      if (label === "AA" || label === "Σ") return null;

      return label;
    })
    .filter(Boolean);
}

function getVisibleStudentRows() {
  return [...document.querySelectorAll("#scoreTable tbody tr.student")];
}

function findQuestionCell(row, questionLabel) {
  const questionOrder = getQuestionOrder();
  const qIndex = questionOrder.indexOf(questionLabel);

  if (qIndex === -1) return null;

  const answerCells = [...row.querySelectorAll("td.answerScore")];
  return answerCells[qIndex] || null;
}

function getStudentIdFromRow(row) {
  return String(row.querySelector(".studentCode")?.textContent || "").trim();
}

function getGradeFromCell(cell) {
  const input = cell?.querySelector("input.scorePoints");
  if (input) return String(input.value || "").trim();
  return "";
}

function getAnswerLinkFromCell(cell) {
  const anchor = cell?.querySelector("a[href]");
  if (!anchor) return "";

  try {
    return new URL(anchor.getAttribute("href"), window.location.origin).href;
  } catch {
    return "";
  }
}

function cleanText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractAnswerTextFromDocument(doc) {
  const selectors = [
    ".answer",
    ".response",
    ".essay",
    ".editor",
    ".content",
    "main"
  ];

  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const text = cleanText(el?.innerText || el?.textContent || "");
    if (text) return text;
  }

  return cleanText(doc.body?.innerText || "");
}

async function fetchAnswerText(answerUrl) {
  if (!answerUrl) return "";

  try {
    const response = await fetch(answerUrl, {
      credentials: "include"
    });

    if (!response.ok) {
      return `[[FETCH_FAILED_${response.status}]]`;
    }

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return extractAnswerTextFromDocument(doc);
  } catch (error) {
    return `[[FETCH_ERROR_${error instanceof Error ? error.message : String(error)}]]`;
  }
}

async function exportQuestionAnswers(questionLabel, buttonEl) {
  const examId = getExamId();
  const studentRows = getVisibleStudentRows();

  if (!studentRows.length) {
    throw new Error("No student rows found.");
  }

  const records = [];

  for (const row of studentRows) {
    const studentId = getStudentIdFromRow(row);
    if (!studentId) continue;

    const cell = findQuestionCell(row, questionLabel);
    if (!cell) continue;

    const grade = getGradeFromCell(cell);
    const answerUrl = getAnswerLinkFromCell(cell);
    const answerText = await fetchAnswerText(answerUrl);

    records.push({
      student_id: studentId,
      question: questionLabel,
      grade,
      answer_url: answerUrl,
      answer_text: answerText
    });

    if (buttonEl) {
      buttonEl.textContent = `CSV ${records.length}/${studentRows.length}`;
    }

    await sleep(80);
  }

  const header = [
    "student_id",
    "question",
    "grade",
    "answer_url",
    "answer_text"
  ];

  const lines = [
    header.map(csvEscape).join(","),
    ...records.map((record) =>
      [
        record.student_id,
        record.question,
        record.grade,
        record.answer_url,
        record.answer_text
      ].map(csvEscape).join(",")
    )
  ];

  const safeQuestion = String(questionLabel).replace(/[^\w.-]+/g, "_");
  const filename = `abitti_${examId}_${safeQuestion}.csv`;

  downloadTextFile(filename, `${lines.join("\n")}\n`);
}

function createHeaderButton(questionLabel) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "arviointiapina-export-btn";
  btn.textContent = "CSV";
  btn.dataset.questionLabel = questionLabel;

  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "…";

    try {
      await exportQuestionAnswers(questionLabel, btn);
      btn.textContent = "OK";
    } catch (error) {
      console.error("[Arviointiapina] Export failed", error);
      btn.textContent = "ERR";
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = originalText;
      }, 1200);
    }
  });

  return btn;
}

function injectStylesOnce() {
  if (document.getElementById("arviointiapina-export-style")) return;

  const style = document.createElement("style");
  style.id = "arviointiapina-export-style";
  style.textContent = `
    .arviointiapina-export-btn {
      margin-left: 6px;
      padding: 2px 6px;
      font-size: 11px;
      line-height: 1.2;
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

function installButtonsIntoHeaders() {
  injectStylesOnce();

  const headers = getQuestionHeaders();

  for (const th of headers) {
    const wrapper = th.querySelector(".wrapper");
    if (!wrapper) continue;

    const textNode = [...wrapper.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE
    );

    const label = (textNode?.textContent || "").trim();
    if (!label || label === "AA" || label === "Σ") continue;

    if (wrapper.querySelector(".arviointiapina-export-btn")) continue;

    const btn = createHeaderButton(label);
    wrapper.appendChild(btn);
  }
}

export function installQuestionExportButtons() {
  installButtonsIntoHeaders();

  const observer = new MutationObserver(() => {
    installButtonsIntoHeaders();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}
