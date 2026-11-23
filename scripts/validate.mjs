#!/usr/bin/env node
// Checks that every skill in this repo installs cleanly everywhere, not only in Claude Code.
//
//   node scripts/validate.mjs [repo-root]
//
// Zero dependencies. Exits 1 if any check fails.
//
// What it checks:
//   1. Every skills/<name>/SKILL.md follows the Agent Skills spec
//      (https://agentskills.io/specification): name rules, name matches the folder,
//      description length, only the six spec fields.
//   2. The frontmatter is YAML that every parser reads the same way. Lenient parsers
//      accept things strict ones reject, and a strict installer skips the skill without
//      failing the install. The rule here is deliberately tighter than YAML: an unquoted
//      value may not contain ": " or " #".
//   3. .claude-plugin/plugin.json and .claude-plugin/marketplace.json agree with the
//      folders on disk, so the Claude Code plugin install ships every skill.
//   4. The README links every skill.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SPEC_FIELDS = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
];
export const MAX_NAME = 64;
export const MAX_DESCRIPTION = 1024;
export const MAX_COMPATIBILITY = 500;

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY_LINE = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/;

// Characters that start something other than a plain string in YAML.
// Unquoted values YAML turns into something other than a string.
const NOT_A_STRING = /^(~|null|true|false|yes|no|on|off|[-+]?(\d[\d_]*)?\.?\d+([eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|[-+]?\.(inf|nan))$/i;

const RESERVED_START = /^[\[\]{}>|*&!%@`,#]/;

/**
 * Reads one scalar value the way a strict YAML parser would, or says why it can't.
 * Returns { value } or { error }.
 */
export function readScalar(raw) {
  const text = raw.trim();
  if (text === "") return { value: "" };

  if (text.startsWith('"')) {
    let out = "";
    for (let i = 1; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\\") {
        const next = text[++i];
        if (next === undefined) break;
        out += next === "n" ? "\n" : next === "t" ? "\t" : next;
      } else if (ch === '"') {
        const rest = text.slice(i + 1);
        if (rest.trim() !== "" && !/^\s+#/.test(rest)) {
          return { error: `unexpected text after the closing double quote: ${rest.trim()}` };
        }
        return { value: out };
      } else {
        out += ch;
      }
    }
    return { error: "double-quoted value is never closed" };
  }

  if (text.startsWith("'")) {
    let out = "";
    for (let i = 1; i < text.length; i++) {
      const ch = text[i];
      if (ch === "'") {
        if (text[i + 1] === "'") {
          out += "'";
          i++;
          continue;
        }
        const rest = text.slice(i + 1);
        if (rest.trim() !== "" && !/^\s+#/.test(rest)) {
          return { error: `unexpected text after the closing single quote: ${rest.trim()}` };
        }
        return { value: out };
      }
      out += ch;
    }
    return { error: "single-quoted value is never closed" };
  }

  if (RESERVED_START.test(text) || /^[-?:]\s/.test(text)) {
    return {
      error: `unquoted value starts with "${text[0]}", which YAML reads as syntax. Wrap the value in quotes`,
    };
  }
  const colon = text.search(/:(\s|$)/);
  if (colon !== -1) {
    return {
      error:
        `unquoted value contains a colon followed by a space (near "${excerpt(text, colon)}"). ` +
        "Strict YAML parsers reject this and installers skip the skill. Reword it or wrap the value in quotes",
    };
  }
  const hash = text.search(/\s#/);
  if (hash !== -1) {
    return {
      error:
        `unquoted value contains " #" (near "${excerpt(text, hash)}"). ` +
        "YAML treats the rest of the line as a comment and drops it. Wrap the value in quotes",
    };
  }
  if (NOT_A_STRING.test(text)) {
    return {
      error: `unquoted value "${text}" is read by YAML as a boolean, null or number, not text. Wrap it in quotes`,
    };
  }
  return { value: text };
}

function excerpt(text, index) {
  const start = Math.max(0, index - 24);
  return text.slice(start, index + 12).trim();
}

/**
 * Splits SKILL.md into frontmatter fields and body.
 * Returns { fields, body, errors }. `fields` maps key to a string, or to an object for a
 * nested mapping such as `metadata`.
 */
export function parseSkillFile(source) {
  const errors = [];
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0] !== "---") {
    return { fields: {}, body: source, errors: ["file must start with a --- frontmatter line"] };
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    return { fields: {}, body: "", errors: ["frontmatter is never closed with a --- line"] };
  }

  const fields = {};
  const front = lines.slice(1, end);
  for (let i = 0; i < front.length; i++) {
    const line = front[i];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (/^\s/.test(line)) {
      errors.push(`frontmatter line ${i + 2} is indented but does not belong to a field: ${line.trim()}`);
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (!match) {
      errors.push(`frontmatter line ${i + 2} is not a "key: value" pair: ${line.trim()}`);
      continue;
    }
    const key = match[1];
    const rest = (match[2] ?? "").trim();
    if (key in fields) errors.push(`field "${key}" appears more than once`);

    // Indented lines that follow belong to this field.
    const block = [];
    while (i + 1 < front.length && (/^\s+\S/.test(front[i + 1]) || front[i + 1].trim() === "")) {
      block.push(front[++i]);
    }
    while (block.length && block[block.length - 1].trim() === "") block.pop();

    if (/^[>|][+-]?$/.test(rest)) {
      const folded = rest.startsWith(">");
      const parts = block.map((entry) => entry.trim());
      fields[key] = folded
        ? parts.join(" ").replace(/\s+/g, " ").trim()
        : parts.join("\n").trim();
      continue;
    }

    if (rest === "" && block.length) {
      const nested = {};
      for (const entry of block) {
        if (entry.trim() === "" || entry.trim().startsWith("#")) continue;
        const inner = KEY_LINE.exec(entry.trim());
        if (!inner) {
          errors.push(`"${key}" must be a simple map of "key: value" lines, found: ${entry.trim()}`);
          continue;
        }
        const scalar = readScalar(inner[2] ?? "");
        if (scalar.error) errors.push(`${key}.${inner[1]}: ${scalar.error}`);
        else nested[inner[1]] = scalar.value;
      }
      fields[key] = nested;
      continue;
    }

    if (block.length) {
      errors.push(
        `"${key}" continues onto indented lines. Keep the value on one line, or use a ">-" block`,
      );
    }
    const scalar = readScalar(rest);
    if (scalar.error) {
      errors.push(`${key}: ${scalar.error}`);
      fields[key] = rest;
    } else {
      fields[key] = scalar.value;
    }
  }

  return { fields, body: lines.slice(end + 1).join("\n"), errors };
}

/** Checks one skill folder. Returns a list of problems, empty when the skill is fine. */
export function validateSkill(dir, folderName) {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return ["has no SKILL.md"];

  const { fields, body, errors } = parseSkillFile(readFileSync(file, "utf8"));
  const problems = [...errors];

  for (const key of Object.keys(fields)) {
    if (!SPEC_FIELDS.includes(key)) {
      problems.push(
        `frontmatter field "${key}" is not in the Agent Skills spec (allowed: ${SPEC_FIELDS.join(", ")}). ` +
          "Move it under metadata, or agents other than the one that defines it will ignore or reject it",
      );
    }
  }

  const name = fields.name;
  if (typeof name !== "string" || name === "") {
    problems.push("name is required");
  } else {
    if (name.length > MAX_NAME) problems.push(`name is ${name.length} characters, the limit is ${MAX_NAME}`);
    if (!NAME_PATTERN.test(name)) {
      problems.push(
        `name "${name}" must be lowercase letters, digits and single hyphens, with no hyphen at either end`,
      );
    }
    if (name !== folderName) problems.push(`name "${name}" must match its folder "${folderName}"`);
  }

  const description = fields.description;
  if (typeof description !== "string" || description === "") {
    problems.push("description is required");
  } else if (description.length > MAX_DESCRIPTION) {
    problems.push(`description is ${description.length} characters, the limit is ${MAX_DESCRIPTION}`);
  }

  if (fields.compatibility !== undefined) {
    if (typeof fields.compatibility !== "string" || fields.compatibility === "") {
      problems.push("compatibility must be a non-empty string when present");
    } else if (fields.compatibility.length > MAX_COMPATIBILITY) {
      problems.push(
        `compatibility is ${fields.compatibility.length} characters, the limit is ${MAX_COMPATIBILITY}`,
      );
    }
  }
  if (fields.metadata !== undefined && typeof fields.metadata !== "object") {
    problems.push("metadata must be a map of string keys to string values");
  }
  if (body.trim() === "") problems.push("has frontmatter but no instructions below it");

  return problems;
}

function readJson(file, problems) {
  if (!existsSync(file)) {
    problems.push("file is missing");
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    problems.push(`not valid JSON: ${error.message}`);
    return null;
  }
}

function normalizePath(path) {
  return path.replace(/^\.\//, "").replace(/\/+$/, "");
}

/** Checks the whole repo. Returns { skills, problems }, where problems is a list of { where, message }. */
export function validateRepo(root) {
  const problems = [];
  const add = (where, message) => problems.push({ where, message });

  const skillsDir = join(root, "skills");
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir)
        .filter((entry) => !entry.startsWith(".") && statSync(join(skillsDir, entry)).isDirectory())
        .sort()
    : [];
  if (skills.length === 0) add("skills/", "no skill folders found");

  for (const skill of skills) {
    for (const message of validateSkill(join(skillsDir, skill), skill)) {
      add(`skills/${skill}/SKILL.md`, message);
    }
  }

  const pluginLabel = ".claude-plugin/plugin.json";
  const pluginProblems = [];
  const plugin = readJson(join(root, pluginLabel), pluginProblems);
  pluginProblems.forEach((message) => add(pluginLabel, message));
  if (plugin) {
    if (typeof plugin.name !== "string" || plugin.name === "") add(pluginLabel, "name is required");
    if (plugin.skills !== undefined) {
      const listed = Array.isArray(plugin.skills) ? plugin.skills : [plugin.skills];
      for (const path of listed) {
        if (typeof path !== "string" || !(path === "." || path.startsWith("./"))) {
          add(pluginLabel, `skills path "${path}" must start with ./`);
        } else if (!existsSync(join(root, path))) {
          add(pluginLabel, `skills path "${path}" does not exist`);
        }
      }
      // Claude Code scans skills/ on its own, so a missing entry still loads there. The list
      // is what readers see, so it has to match the folders.
      const scansWholeFolder = listed.some((path) => typeof path === "string" && normalizePath(path) === "skills");
      if (!scansWholeFolder) {
        const names = new Set(listed.filter((path) => typeof path === "string").map(normalizePath));
        for (const skill of skills) {
          if (!names.has(`skills/${skill}`)) add(pluginLabel, `skills list is missing "./skills/${skill}"`);
        }
      }
    }
  }

  const marketLabel = ".claude-plugin/marketplace.json";
  const marketProblems = [];
  const market = readJson(join(root, marketLabel), marketProblems);
  marketProblems.forEach((message) => add(marketLabel, message));
  if (market) {
    if (typeof market.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(market.name)) {
      add(marketLabel, "name is required and may only use letters, digits, dots, underscores and hyphens");
    }
    if (!market.owner || typeof market.owner.name !== "string" || market.owner.name === "") {
      add(marketLabel, "owner.name is required");
    }
    const entries = Array.isArray(market.plugins) ? market.plugins : [];
    if (entries.length === 0) add(marketLabel, "plugins must list at least one plugin");
    for (const entry of entries) {
      if (typeof entry.name !== "string" || entry.name === "") add(marketLabel, "every plugin entry needs a name");
      if (typeof entry.source === "string") {
        if (!(entry.source === "." || entry.source.startsWith("./"))) {
          add(marketLabel, `plugin "${entry.name}" source "${entry.source}" must start with ./`);
        } else if (entry.source.includes("..")) {
          add(marketLabel, `plugin "${entry.name}" source may not contain ".."`);
        } else if (!existsSync(join(root, entry.source))) {
          add(marketLabel, `plugin "${entry.name}" source "${entry.source}" does not exist`);
        }
      } else if (!entry.source || typeof entry.source !== "object") {
        add(marketLabel, `plugin "${entry.name}" needs a source`);
      }
    }
    if (plugin && typeof plugin.name === "string") {
      const self = entries.find(
        (entry) => typeof entry.source === "string" && ["", "."].includes(normalizePath(entry.source)),
      );
      if (!self) {
        add(marketLabel, 'no plugin entry points at this repo (source "./")');
      } else if (self.name !== plugin.name) {
        add(
          marketLabel,
          `plugin entry is named "${self.name}" but plugin.json says "${plugin.name}". People install by the entry name, so the two must match`,
        );
      }
    }
  }

  const readmeFile = join(root, "README.md");
  if (!existsSync(readmeFile)) {
    add("README.md", "is missing");
  } else {
    const readme = readFileSync(readmeFile, "utf8");
    for (const skill of skills) {
      if (!readme.includes(`skills/${skill}/SKILL.md`)) {
        add("README.md", `does not link skills/${skill}/SKILL.md`);
      }
    }
  }

  return { skills, problems };
}

function main() {
  const root = resolve(process.argv[2] ?? process.cwd());
  const { skills, problems } = validateRepo(root);
  if (problems.length === 0) {
    console.log(`ok: ${skills.length} skills (${skills.join(", ")}), plugin and marketplace manifests in sync`);
    return 0;
  }
  for (const { where, message } of problems) console.error(`${where}: ${message}`);
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"} found`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
