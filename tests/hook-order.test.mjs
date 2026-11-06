// React's rule of hooks: every render calls the same hooks in the same order. A hook behind `&&`,
// inside an `if`, or after an early return crashes a release build the first time that changes
// ("Rendered more hooks than during the previous render"), which is how the phone app fell over when
// its connection dropped. This reads every component and hook in both apps and finds those.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOTS = ["src", "mobile/src"];

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const isHookName = (name) => /^use[A-Z0-9]/.test(name);
const isComponentName = (name) => /^[A-Z]/.test(name);

/** `useX(...)` or `React.useX(...)`. */
function hookCalled(node) {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return isHookName(callee.text) ? callee.text : null;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && /^React$/.test(callee.expression.text)) {
    return isHookName(callee.name.text) ? callee.name.text : null;
  }
  return null;
}

const isFunctionLike = (node) =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);

/** The component or hook a function is, by the name it goes by; null for anything else. */
function hostName(fn) {
  const name = (fn.name && ts.isIdentifier(fn.name) && fn.name.text) || null;
  if (name) return isComponentName(name) || isHookName(name) ? name : null;
  let parent = fn.parent;
  // `memo(function …)`, `forwardRef((props, ref) => …)`
  while (parent && ts.isCallExpression(parent)) parent = parent.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    const n = parent.name.text;
    return isComponentName(n) || isHookName(n) ? n : null;
  }
  return null;
}

/** Hooks called conditionally in one component's body. Functions inside it are their own business. */
function problemsIn(fn, source) {
  const problems = [];
  const where = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  let returned = false;

  const walk = (node, conditional) => {
    if (isFunctionLike(node)) return;
    const hook = hookCalled(node);
    if (hook) {
      if (conditional) problems.push(`${where(node)}: ${hook} is called conditionally (${conditional})`);
      else if (returned) problems.push(`${where(node)}: ${hook} comes after an early return`);
    }
    if (ts.isConditionalExpression(node)) {
      walk(node.condition, conditional);
      walk(node.whenTrue, conditional || "?:");
      walk(node.whenFalse, conditional || "?:");
      return;
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
      walk(node.left, conditional);
      walk(node.right, conditional || node.operatorToken.getText(source));
      return;
    }
    if (ts.isIfStatement(node)) {
      walk(node.expression, conditional);
      walk(node.thenStatement, conditional || "if");
      if (node.elseStatement) walk(node.elseStatement, conditional || "else");
      return;
    }
    if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      ts.forEachChild(node, (child) => walk(child, conditional || "loop"));
      return;
    }
    if (ts.isSwitchStatement(node) || ts.isTryStatement(node)) {
      ts.forEachChild(node, (child) => walk(child, conditional || "switch or try"));
      return;
    }
    ts.forEachChild(node, (child) => walk(child, conditional));
  };

  /** Whether running these statements can leave the function early. */
  const canReturn = (node) => {
    if (isFunctionLike(node)) return false;
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return true;
    let found = false;
    ts.forEachChild(node, (child) => {
      found ||= canReturn(child);
    });
    return found;
  };

  if (!fn.body || !ts.isBlock(fn.body)) {
    if (fn.body) walk(fn.body, null);
    return problems;
  }
  for (const statement of fn.body.statements) {
    walk(statement, null);
    // The last statement's own return is the ordinary end of the component.
    if (statement !== fn.body.statements.at(-1) && canReturn(statement)) returned = true;
  }
  return problems;
}

function problemsInFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, kind);
  const problems = [];
  const visit = (node) => {
    if (isFunctionLike(node) && hostName(node)) {
      for (const p of problemsIn(node, source)) problems.push(`${file.replace(/\\/g, "/")}:${p}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
}

test("the check itself sees a hook behind && and one after an early return", () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.cwd()), ".hook-order-"));
  try {
    const file = path.join(dir, "Sample.tsx");
    fs.writeFileSync(
      file,
      `export function A() { const a = useOne() && useTwo(); return a; }
       export function B({ x }) { if (x) return null; const b = useOne(); return b; }
       export function C() { const c = useOne(); const d = useTwo(() => { if (c) return useLater; }); return c ? d : null; }`
    );
    const found = problemsInFile(file);
    assert.equal(found.length, 2, found.join("\n"));
    assert.match(found[0], /useTwo is called conditionally/);
    assert.match(found[1], /useOne comes after an early return/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no component or hook in either app breaks the rule of hooks", () => {
  const problems = ROOTS.flatMap((root) => sourceFiles(root)).flatMap(problemsInFile);
  assert.deepEqual(problems, []);
});
