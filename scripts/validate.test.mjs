// Run with: node --test
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseSkillFile, readScalar, validateRepo, validateSkill } from "./validate.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function skillFile(frontmatter, body = "# Title\n\nDo the thing.\n") {
  return `---\n${frontmatter}\n---\n\n${body}`;
}

function tempSkill(folder, content) {
  const root = mkdtempSync(join(tmpdir(), "skills-validate-"));
  const dir = join(root, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
  return { root, dir };
}

/** A copy of the real repo that a test can break without touching the working tree. */
function repoCopy() {
  const root = mkdtempSync(join(tmpdir(), "skills-repo-"));
  for (const entry of [".claude-plugin", "skills", "README.md"]) {
    cpSync(join(repoRoot, entry), join(root, entry), { recursive: true });
  }
  return root;
}

function messages(result) {
  return result.problems.map(({ where, message }) => `${where}: ${message}`);
}

test("the repo itself passes", () => {
  const result = validateRepo(repoRoot);
  assert.deepEqual(messages(result), []);
  assert.ok(result.skills.length >= 3);
});

test("readScalar accepts plain, single-quoted and double-quoted values", () => {
  assert.deepEqual(readScalar("plain words, with commas"), { value: "plain words, with commas" });
  assert.deepEqual(readScalar(`'it''s quoted: fine'`), { value: "it's quoted: fine" });
  assert.deepEqual(readScalar(`"say \\"hi\\": fine"`), { value: 'say "hi": fine' });
  assert.deepEqual(readScalar("https://example.com/a:b"), { value: "https://example.com/a:b" });
  assert.deepEqual(readScalar(`he said "bold claim" twice`), { value: 'he said "bold claim" twice' });
});

test("readScalar rejects the values strict YAML parsers reject or misread", () => {
  assert.match(readScalar("Composes with bold-claim: if a doc exists").error, /colon followed by a space/);
  assert.match(readScalar("ends with a colon:").error, /colon followed by a space/);
  assert.match(readScalar("use issue #12 or PR #13").error, /comment/);
  assert.match(readScalar("[draft] review").error, /Wrap the value in quotes/);
  assert.match(readScalar("- leading dash").error, /Wrap the value in quotes/);
  assert.match(readScalar(`"never closed`).error, /never closed/);
  assert.match(readScalar(`'closed' then more`).error, /after the closing single quote/);
  assert.match(readScalar(`"closed"#glued`).error, /after the closing double quote/);
  assert.match(readScalar("true").error, /boolean, null or number/);
  assert.match(readScalar("1.0").error, /boolean, null or number/);
  assert.deepEqual(readScalar(`"1.0" # a comment`), { value: "1.0" });
});

test("the claim-review regression: a colon inside an unquoted description fails", () => {
  const { root, dir } = tempSkill(
    "claim-review",
    skillFile("name: claim-review\ndescription: Review a PR. Composes with bold-claim: if a doc is present, use it."),
  );
  const problems = validateSkill(dir, "claim-review");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^description: unquoted value contains a colon/);
  rmSync(root, { recursive: true });
});

test("folded block descriptions and metadata maps parse", () => {
  const { fields, errors } = parseSkillFile(
    skillFile(
      [
        "name: demo",
        "description: >-",
        "  First line: with a colon,",
        "  second line.",
        "license: MIT",
        "metadata:",
        "  author: someone",
        '  version: "1.0"',
      ].join("\n"),
    ),
  );
  assert.deepEqual(errors, []);
  assert.equal(fields.description, "First line: with a colon, second line.");
  assert.deepEqual(fields.metadata, { author: "someone", version: "1.0" });
});

test("spec rules: name shape, folder match, lengths, unknown fields, empty body", () => {
  const cases = [
    ["name: Demo\ndescription: ok", "demo", /lowercase letters/],
    ["name: demo--x\ndescription: ok", "demo--x", /single hyphens/],
    ["name: -demo\ndescription: ok", "-demo", /Wrap the value in quotes|lowercase letters/],
    ["name: other\ndescription: ok", "demo", /must match its folder "demo"/],
    [`name: ${"a".repeat(65)}\ndescription: ok`, "a".repeat(65), /limit is 64/],
    ["name: demo", "demo", /description is required/],
    ["description: ok", "demo", /name is required/],
    [`name: demo\ndescription: ${"d".repeat(1025)}`, "demo", /limit is 1024/],
    [`name: demo\ndescription: ok\ncompatibility: ${"c".repeat(501)}`, "demo", /limit is 500/],
    ["name: demo\ndescription: ok\ndisable-model-invocation: true", "demo", /not in the Agent Skills spec/],
    ["name: demo\ndescription: ok\nname: demo", "demo", /appears more than once/],
  ];
  for (const [frontmatter, folder, expected] of cases) {
    const { root, dir } = tempSkill(folder, skillFile(frontmatter));
    const problems = validateSkill(dir, folder);
    assert.ok(
      problems.some((problem) => expected.test(problem)),
      `expected ${expected} for:\n${frontmatter}\ngot: ${JSON.stringify(problems)}`,
    );
    rmSync(root, { recursive: true });
  }

  const empty = tempSkill("demo", skillFile("name: demo\ndescription: ok", ""));
  assert.ok(validateSkill(empty.dir, "demo").some((problem) => /no instructions/.test(problem)));
  rmSync(empty.root, { recursive: true });

  const noFrontmatter = tempSkill("demo", "# Just a heading\n");
  assert.ok(validateSkill(noFrontmatter.dir, "demo").some((problem) => /must start with a ---/.test(problem)));
  rmSync(noFrontmatter.root, { recursive: true });

  const missing = mkdtempSync(join(tmpdir(), "skills-validate-"));
  assert.deepEqual(validateSkill(missing, "demo"), ["has no SKILL.md"]);
  rmSync(missing, { recursive: true });
});

test("a new skill folder must reach plugin.json and the README", () => {
  const root = repoCopy();
  mkdirSync(join(root, "skills", "new-skill"));
  writeFileSync(
    join(root, "skills", "new-skill", "SKILL.md"),
    skillFile("name: new-skill\ndescription: Does a new thing. Use when asked for the new thing."),
  );
  const found = messages(validateRepo(root));
  assert.deepEqual(found, [
    '.claude-plugin/plugin.json: skills list is missing "./skills/new-skill"',
    "README.md: does not link skills/new-skill/SKILL.md",
  ]);
  rmSync(root, { recursive: true });
});

test("plugin.json without a skills list relies on the default skills/ scan", () => {
  const root = repoCopy();
  const file = join(root, ".claude-plugin", "plugin.json");
  const plugin = JSON.parse(readFileSync(file, "utf8"));
  delete plugin.skills;
  writeFileSync(file, JSON.stringify(plugin));
  assert.deepEqual(messages(validateRepo(root)), []);
  rmSync(root, { recursive: true });
});

test("plugin.json paths must exist and start with ./", () => {
  const root = repoCopy();
  const file = join(root, ".claude-plugin", "plugin.json");
  const plugin = JSON.parse(readFileSync(file, "utf8"));
  plugin.skills = [...plugin.skills, "skills/bold-claim", "./skills/gone"];
  writeFileSync(file, JSON.stringify(plugin));
  const found = messages(validateRepo(root));
  assert.ok(found.some((line) => /"skills\/bold-claim" must start with \.\//.test(line)));
  assert.ok(found.some((line) => /"\.\/skills\/gone" does not exist/.test(line)));
  rmSync(root, { recursive: true });
});

test("marketplace.json must exist, name an owner, and match plugin.json", () => {
  const missing = repoCopy();
  rmSync(join(missing, ".claude-plugin", "marketplace.json"));
  assert.deepEqual(messages(validateRepo(missing)), [".claude-plugin/marketplace.json: file is missing"]);
  rmSync(missing, { recursive: true });

  const root = repoCopy();
  const file = join(root, ".claude-plugin", "marketplace.json");
  const market = JSON.parse(readFileSync(file, "utf8"));
  delete market.owner;
  market.plugins[0].name = "renamed";
  writeFileSync(file, JSON.stringify(market));
  const found = messages(validateRepo(root));
  assert.ok(found.some((line) => /owner\.name is required/.test(line)));
  assert.ok(found.some((line) => /named "renamed" but plugin\.json says "brainsparker-skills"/.test(line)));
  rmSync(root, { recursive: true });

  const broken = repoCopy();
  writeFileSync(join(broken, ".claude-plugin", "marketplace.json"), "{ not json");
  assert.ok(messages(validateRepo(broken)).some((line) => /marketplace\.json: not valid JSON/.test(line)));
  rmSync(broken, { recursive: true });
});
