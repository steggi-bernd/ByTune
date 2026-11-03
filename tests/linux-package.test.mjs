// The Linux packages: what electron-builder needs to build them (the .deb scripts use only
// the names it fills in, and still parse in bash once filled), what the desktop needs to
// show Songsta as itself, and secrets on a desktop without a keyring.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const { linux, deb } = pkg.build;
const scripts = [deb.afterInstall, deb.afterRemove].map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]);

// electron-builder's FpmTarget: these plus the linux options; any other ${name} stops the build.
const macros = {
  executable: linux.executableName,
  sanitizedProductName: pkg.productName.replace(/[/\\:*?"<>|]/g, ""),
  productFilename: pkg.productName,
};
const fill = (text) =>
  text.replace(/\$\{([a-zA-Z]+)\}/g, (_, name) => {
    if (!(name in macros) && !(name in linux)) throw new Error(`electron-builder knows no macro ${name}`);
    return macros[name] ?? linux[name];
  });

test("the Linux build makes an AppImage and a .deb for x64", () => {
  assert.deepEqual(linux.target.map((t) => t.target), ["AppImage", "deb"]);
  for (const t of linux.target) assert.deepEqual(t.arch, ["x64"]);
  assert.equal(linux.icon, "build/icon.png");
  assert.ok(pkg.build.files.includes("build/icon.png"), "the window icon ships with the app");
});

test("the .deb has a maintainer with an address (fpm refuses one without)", () => {
  assert.match(linux.maintainer, /^[^<>]+ <[^<>@\s]+@[^<>@\s]+>$/);
});

test("the desktop name is the installed .desktop file, so docks match the window to it", () => {
  // Electron reports desktopName (minus .desktop) as the Wayland app id; electron-builder
  // installs the entry as <executableName>.desktop.
  assert.equal(pkg.desktopName, `${linux.executableName}.desktop`);
});

test("the .deb scripts use only names electron-builder fills in", () => {
  for (const [file, text] of scripts) assert.doesNotThrow(() => fill(text), file);
});

test("the .deb scripts are plain LF text (bash chokes on CR)", () => {
  for (const [file, text] of scripts) {
    assert.ok(!text.includes("\r"), `${file} has CR`);
    assert.ok(/^[\x00-\x7f]*$/.test(text), `${file} is not ASCII`);
    assert.ok(text.startsWith("#!/bin/bash\n"), `${file} shebang`);
  }
});

test("the AppArmor profile is made for the installed binary and removed only on removal", () => {
  const install = fill(scripts[0][1]);
  assert.ok(install.includes(`profile songsta "/opt/Songsta/songsta" flags=(unconfined) {`));
  assert.ok(install.includes("userns,"));
  const remove = fill(scripts[1][1]);
  assert.match(remove, /if \[ "\$1" = remove \] \|\| \[ "\$1" = purge \]; then[\s\S]*rm -f '\/etc\/apparmor\.d\/songsta'/);
});

const bash = spawnSync("bash", ["--version"], { encoding: "utf8" });
test("the filled-in .deb scripts parse in bash", { skip: bash.status !== 0 && "no bash here" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bytune-deb-"));
  try {
    for (const [file, text] of scripts) {
      const out = path.join(dir, path.basename(file, ".tpl") + ".sh");
      fs.writeFileSync(out, fill(text));
      const r = spawnSync("bash", ["-n", out], { encoding: "utf8" });
      assert.equal(r.status, 0, `${file}: ${r.stderr}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------ secrets */
async function loadSecrets() {
  const out = await build({
    entryPoints: [fileURLToPath(new URL("../electron/secrets.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [
      {
        name: "electron-stub",
        setup(b) {
          b.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js", contents: "export const safeStorage = globalThis.__safeStorage;" }));
        },
      },
    ],
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}

function withPlatform(platform, fn) {
  const real = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", real);
  }
}

test("without a keyring on Linux a secret is kept as plain, not under Chromium's fixed key", async () => {
  let backend = "basic_text";
  globalThis.__safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => {
      if (process.platform !== "linux") throw new Error("Linux-only API called elsewhere");
      return backend;
    },
    encryptString: (s) => Buffer.from(`sealed(${s})`),
    decryptString: (b) => b.toString().replace(/^sealed\((.*)\)$/, "$1"),
  };
  const { sealSecret, openSecret } = await loadSecrets();
  withPlatform("linux", () => {
    assert.equal(sealSecret("token"), "plain:token");
    backend = "gnome_libsecret";
    const sealed = sealSecret("token");
    assert.match(sealed, /^enc:/);
    assert.equal(openSecret(sealed), "token");
    backend = "kwallet6";
    assert.match(sealSecret("token"), /^enc:/);
  });
  for (const platform of ["win32", "darwin"]) {
    withPlatform(platform, () => assert.match(sealSecret("token"), /^enc:/));
  }
});
