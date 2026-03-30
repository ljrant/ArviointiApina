function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result.map((value) => value.trim());
}

function parseCsvText(text) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "");

  return lines.map(parseCsvLine);
}

function validateAndMapCsvRows(rows) {
  const mapped = new Map();

  if (!rows?.length) return mapped;

  const dataRows = rows.slice(1);

  for (const rawRow of dataRows) {
    if (!rawRow?.length) continue;

    const studentId = String(rawRow[0] ?? "").trim();
    const answer = String(rawRow[1] ?? "").trim();
    const grade = String(rawRow[2] ?? "").trim();
    const teacherNote = String(rawRow[3] ?? "").trim();

    if (!studentId) continue;

    mapped.set(studentId, {
      student_id: studentId,
      answer,
      grade,
      teacher_note: teacherNote
    });
  }

  return mapped;
}

export function getExamId() {
  const match = window.location.pathname.match(/^\/school\/grading\/([a-f0-9-]+)/i);
  return match ? match[1] : null;
}

export function getCurrentQuestionFromUrl() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || null;
}

export function getQuestionOrder() {
  const ths = [
    ...document.querySelectorAll("#scoreTable thead tr.questionNumberRow th")
  ];

  return ths
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

export function getVisibleStudentRows() {
  return [...document.querySelectorAll("#scoreTable tbody tr.student")];
}

function findCurrentQuestionCell(row, currentQuestion) {
  const questionOrder = getQuestionOrder();
  const qIndex = questionOrder.indexOf(currentQuestion);

  if (qIndex === -1) return null;

  const answerCells = [...row.querySelectorAll("td.answerScore")];
  return answerCells[qIndex] || null;
}

async function setScoreForCell(cell, grade) {
  if (!cell) return false;

  const input = cell.querySelector("input.scorePoints");
  if (!input) return false;

  input.focus();
  input.value = grade;

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));

  await sleep(250);
  return true;
}

async function tryAddTeacherNoteForCell(cell, note) {
  if (!cell || !note) return false;

  cell.click();
  await sleep(350);

  const addBtn = document.querySelector(".comment .addCommentToAnswer");
  if (!addBtn) return false;

  addBtn.click();
  await sleep(250);

  const input =
    document.querySelector(".comment textarea") ||
    document.querySelector('.comment input[type="text"]') ||
    document.querySelector(".comment input:not([type])") ||
    document.querySelector('.comment [contenteditable="true"]');

  if (!input) return false;

  if ("value" in input) {
    input.focus();
    input.value = note;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    input.textContent = note;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  await sleep(150);

  const buttons = [...document.querySelectorAll(".comment button")];
  const saveBtn = buttons.find((btn) =>
    /save|tallenna|ok|lisää|add/i.test(btn.textContent || "")
  );

  if (saveBtn) {
    saveBtn.click();
  } else if ("value" in input) {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true
      })
    );

    input.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        bubbles: true
      })
    );
  }

  await sleep(350);
  return true;
}

export async function importGradesAndNotesFromCsvText(csvText) {
  const examId = getExamId();
  const currentQuestion = getCurrentQuestionFromUrl();

  if (!examId) {
    throw new Error("Could not detect exam ID from URL.");
  }

  if (!currentQuestion) {
    throw new Error("Could not detect current question from URL.");
  }

  const rows = parseCsvText(csvText);
  const csvMap = validateAndMapCsvRows(rows);

  if (!csvMap.size) {
    throw new Error(
      "No valid CSV rows found. Expected columns: student_id, answer, grade, notes"
    );
  }

  const studentRows = getVisibleStudentRows();

  let matchedCount = 0;
  let gradeCount = 0;
  let noteCount = 0;
  const missing = [];

  for (const row of studentRows) {
    const studentCodeEl = row.querySelector(".studentCode");
    const studentId = String(studentCodeEl?.textContent || "").trim();

    if (!studentId) continue;

    const record = csvMap.get(studentId);

    if (!record) {
      missing.push(studentId);
      continue;
    }

    matchedCount += 1;

    const cell = findCurrentQuestionCell(row, currentQuestion);
    if (!cell) continue;

    if (record.grade !== "") {
      const ok = await setScoreForCell(cell, record.grade);
      if (ok) gradeCount += 1;
    }

    if (record.teacher_note !== "") {
      const ok = await tryAddTeacherNoteForCell(cell, record.teacher_note);
      if (ok) noteCount += 1;
    }

    await sleep(150);
  }

  return {
    ok: true,
    examId,
    question: currentQuestion,
    matchedCount,
    gradeCount,
    noteCount,
    missing
  };
}
