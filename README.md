# ROS Package Explorer

A read-only Linux desktop app for exploring ROS packages in a local folder: metadata,
declared dependencies (with reverse dependencies), and package files. It works fully
offline and needs no ROS installation, ROS master, sourced workspace, or build.

Stack: Electron + React + TypeScript + Tailwind CSS, scanning in a Node `worker_threads`
worker, packaged with Electron Forge. Specification: [SPECIFICATION.md](SPECIFICATION.md).

## Supported platforms

Ubuntu 22.04+ and Debian 12+ on **x64 only**. Other distributions/architectures are
untested. Runtime libraries (GTK 3, NSS, etc.) are declared in the `.deb`; no Node.js or
developer tools are needed.

## Install

`.deb` (recommended; installs `chrome-sandbox` setuid root):

```sh
sudo apt install ./ros-package-explorer_0.1.0_amd64.deb
ros-package-explorer
sudo apt remove ros-package-explorer      # uninstall
```

Portable archive: unzip and run `./ros-package-explorer`. The Chromium sandbox needs either
`sudo chown root chrome-sandbox && sudo chmod 4755 chrome-sandbox` in the unpacked folder, or
(on systems that allow unprivileged user namespaces) works as is. On Ubuntu 24.04+ AppArmor
restricts those namespaces, so use the chown/chmod step. Uninstall by deleting the folder.
Preferences live in `~/.config/ros-package-explorer/preferences.json`.

## Develop

```sh
npm install
npm start            # dev run
npm run typecheck
npm test             # parser, discovery, IPC authorization, scan lifecycle, UI smoke, search bench
npm run make -- --arch=x64   # .deb and .zip in out/make
```

## Discovery semantics

- Every regular file named exactly `package.xml` is found, recursively, **including hidden
  and generated directories** (`.git`, `build`, `devel`, `install`) and inside package
  directories. This is a filesystem explorer, not catkin discovery: copies and nested
  manifests build tools would ignore appear too.
- Records beneath a `CATKIN_IGNORE` directory are shown and annotated "ignored".
- **Symlinks (directories and files) are never followed**; skipped links appear in diagnostics.
- Unreadable directories/manifests make the scan **partial**; cancellation marks it
  **incomplete**. Malformed, unsupported, or oversized manifests stay in the list with
  their relative path as label and a diagnostic.
- Package identity is the manifest path, so duplicate names remain separate records.
- A `package.xml` does not prove a package is ROS 1 or buildable; declared build tools
  and build type are shown as evidence only.
- Dependencies are manifest declarations matched by name within the scan. Conditions
  (format 3) are shown as "Not evaluated"; `rosdep` keys and installed packages are not
  consulted, so unmatched names read "Not found in scanned workspace". Groups are
  separate from package names. Unparseable manifests are excluded from matching.
- Dependency matching and reverse dependencies become available when the scan finishes.

## Limits

- Previews are capped at 1 MiB; larger files show metadata/limit message, binary files show
  metadata. Manifests larger than 1 MiB are not parsed (visible with a diagnostic).
- Directory listings show at most 5,000 entries.
- XML: DOCTYPE/entity declarations are blanked, never expanded; element depth ≤ 64 and
  ≤ 100,000 elements.

## Security model

Context isolation and sandbox on, no Node in the renderer, narrow typed preload API, CSP in
production builds, blocked navigation/new windows, all permissions denied. The main process
validates every IPC argument, ties requests to the current scan id, and re-checks paths
(no `..`, no symlink components, inside the package directory) at each access.
Workspaces can only be opened through the native picker or by reopening a recent entry.
External links open only if `http`/`https`.

## Keyboard

Ctrl+O open · Ctrl+F search · F5 / Ctrl+R refresh · Alt+←/→ back/forward · ↑/↓/Home/End in the
package list · ←/→ between tabs · ←/→ on the divider to resize the sidebar.

## Known gaps

- shadcn/ui was not used; Tailwind with small hand-written components instead.
- Packaged `.deb` install/uninstall on a clean machine (ACC-13) and a full keyboard-only
  walkthrough (ACC-12) were not performed. The unpacked packaged app was launched under
  Xvfb and scanned a workspace successfully.
- Not tested with a real-world workspace of thousands of packages; no scan-time SLA claimed.
- Search benchmark (`npm run bench`) measures the filter function only, not renderer cost.
- Source line numbers are only reported for XML syntax errors.
