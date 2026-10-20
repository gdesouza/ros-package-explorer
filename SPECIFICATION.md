# ROS Package Explorer

Status: implementation handoff; no application code has been created.
Date: 2026-10-20

## 1. Purpose

Create a modern, read-only Linux desktop application for exploring ROS 1
packages in a local workspace. The user selects a folder, the application
recursively discovers `package.xml` files, and the user selects packages to
inspect their metadata, dependencies, and files.

Core functionality must work offline without a ROS installation, a running
ROS master, a sourced workspace, or a build environment.

## 2. User decisions and design baseline

The user explicitly selected:

- Application name: **ROS Package Explorer**.
- Platform: Linux desktop.
- Initial scope: metadata, dependencies, and package file browsing.
- Experience: modern appearance, easy-to-navigate components, and easy distribution.

The design discussed with the user recommends the following stack. These are
implementation recommendations, not independently confirmed user constraints:

| Layer | Recommendation |
| --- | --- |
| Desktop shell | Electron |
| Interface | React and TypeScript |
| Styling and components | Tailwind CSS and shadcn/ui |
| Discovery and indexing | Background Node.js worker |
| Packaging | Electron Forge |
| Initial artifacts | `.deb` and a portable archive |

Use `ros-package-explorer` as the project/package slug. Electron trades a larger
download and memory footprint for consistent rendering and mature desktop
packaging. Revisit the stack only if a concrete compatibility or distribution
requirement makes it unsuitable; do not silently replace it.

The supported Linux versions and CPU architectures remain to be decided.
Confirm these before choosing the Electron major version and claiming release
compatibility. In particular, do not assume a current Electron release supports
older ROS workstations. Do not depend on the host ROS Python environment.

## 3. MVP scope

Include:

- Native workspace folder selection.
- Exhaustive recursive manifest discovery, with progress and cancellation.
- Searchable, sortable package list.
- Package metadata and manifest diagnostics.
- Typed dependency browsing and reverse-dependency navigation.
- Read-only package file tree and text previews.
- Original manifest inspection.
- Manual refresh, light/dark themes, and basic local preferences.
- Linux packaging.

Exclude:

- Editing manifests or workspace files.
- Building packages or executing workspace scripts.
- Installing or resolving system dependencies.
- Running launch files or nodes.
- Inspecting live ROS nodes, topics, or services.
- Multiple simultaneous workspaces and overlay resolution.
- Automatic file watching, graphical dependency visualization, and inventory export.

Those excluded capabilities may be future work, but must not delay the MVP.

## 4. User experience

### Layout

```text
+--------------------------------------------------------------------------+
| ROS Package Explorer      [Open workspace] [Refresh] [Theme]              |
| /home/user/robot_ws                                  Scan complete        |
+------------------------+-------------------------------------------------+
| Search packages...     | navigation_stack                    v1.4.0      |
| Filters / Sort         | src/navigation/navigation_stack                 |
|                        |                                                 |
| navigation_stack       | Overview | Dependencies | Files | Manifest      |
| robot_description      |-------------------------------------------------|
| sensor_driver          | Description                                     |
| ...                    | Navigation components for the robot.            |
|                        |                                                 |
|                        | Maintainers    Robotics Team                    |
|                        | License        BSD-3-Clause                     |
|                        | Build tool     catkin                           |
|                        |                                                 |
|                        | [Copy path] [Open folder]                       |
+------------------------+-------------------------------------------------+
| 142 packages | 2 warnings | 1 invalid manifest | [View diagnostics]        |
+--------------------------------------------------------------------------+
```

Use a resizable package sidebar and a main detail pane. Keep package identity
and path visible across tabs. Use virtualized lists for large workspaces.

### Workflow

1. Select any local folder, including a workspace root or its `src` folder.
2. Scan in the background, showing directories visited and manifests found.
3. Search or sort the resulting package list.
4. Select a package to view details.
5. Follow workspace dependencies or inspect package files.
6. Refresh manually after external changes.

Preserve search text and list position while switching packages. Provide
Back/Forward navigation for package-to-package dependency browsing.

### Detail tabs

| Tab | Content |
| --- | --- |
| Overview | Name, version, description, maintainers, authors, licenses, URLs, path, manifest format, declared build tools/type, and diagnostic summary |
| Dependencies | Original dependency declarations, readable categories, constraints, conditions, workspace matches, and reverse dependencies |
| Files | Lazy-loaded directory tree and read-only text preview |
| Manifest | Original `package.xml`, XML highlighting, and parsing/validation diagnostics |

### Required UI states

- No workspace selected.
- Scanning, with progress and cancellation.
- Complete scan.
- Partial scan due to discovery errors.
- Cancelled scan, explicitly marked incomplete.
- No manifests found.
- No packages match the current search.
- Invalid or unsupported manifest.
- Missing, changed, unreadable, oversized, or binary preview file.
- Workspace no longer accessible.

Never present partial or cancelled results as a complete workspace inventory.

## 5. Functional requirements

### Discovery

| ID | Requirement |
| --- | --- |
| DISC-01 | Select a local folder using a native directory picker. |
| DISC-02 | Discover files named exactly `package.xml` recursively, including a manifest directly inside the selected folder and manifests nested inside package directories. Do not stop recursion when a manifest is found. |
| DISC-03 | Include hidden and generated directories by default. Do not implicitly exclude `.git`, `build`, `devel`, or `install`. Any exclusions must be user-enabled and visible. A source-only preset is optional, not required for MVP. |
| DISC-04 | Do not follow directory symlinks by default. Report skipped links without treating them as fatal scan errors. Prevent loops and traversal outside the authorized root. |
| DISC-05 | Report unreadable directories, inaccessible manifests, and malformed manifests without aborting discovery elsewhere. |
| DISC-06 | Run discovery off the UI thread, report directories visited and manifests found, and support cancellation. Do not invent a percentage without a known total. |
| DISC-07 | Support manual refresh. Events from superseded scans must not modify the current workspace's results. |
| DISC-08 | Keep duplicate package names as separate records, identified by manifest path and displayed with distinguishing relative paths. |
| DISC-09 | Do not use `CATKIN_IGNORE` to prune the default scan. Annotate records beneath ignored directories as ignored by catkin discovery. |

This application is a filesystem explorer, not a reproduction of catkin package
discovery. Exhaustive results may contain generated copies, ignored packages,
and nested manifests that build tooling would not recognize as active packages.
Do not claim that all discovered packages are buildable.

For file symlinks, use the same conservative MVP policy: do not follow them,
including symlinked manifests and preview files. Make this behavior visible.
Supporting links later requires an explicit authorization and deduplication policy.

### Package list and metadata

| ID | Requirement |
| --- | --- |
| PKG-01 | Show package name, relative path, version, and diagnostic status in the list. |
| PKG-02 | Provide case-insensitive search over name, description, and relative path. Default to name sorting with relative path as a stable tie-breaker; offer path sorting. |
| PKG-03 | Support manifest formats 1, 2, and 3 using their applicable semantics, rather than parsing every format as the same schema. |
| PKG-04 | Display repeated fields, including multiple maintainers, authors, licenses, and URLs. |
| PKG-05 | Distinguish absent optional metadata from invalid required metadata. Do not invent values. |
| PKG-06 | Keep malformed or unsupported manifests visible using their relative paths as fallback labels. Preserve access to their original content and diagnostics where readable. |
| PKG-07 | Preserve export metadata and unknown elements for inspection even when no dedicated UI representation exists. |
| PKG-08 | Provide basic filters for diagnostic status and duplicate names. |

The presence of `package.xml` does not prove that a package is ROS 1. Formats
are also used by ROS 2 and shared-source packages. Show declared build tools
and build types as evidence; do not silently classify every record as ROS 1.

### Dependencies

| ID | Requirement |
| --- | --- |
| DEP-01 | Show declared names, original XML tags, version constraints, and conditions. |
| DEP-02 | Offer understandable categories such as Build, Build tool, Export, Runtime, and Test while retaining original declarations. Normalize only according to the manifest format. |
| DEP-03 | Link dependencies with exactly one matching scanned package. For multiple name matches, show an explicit choice. Never silently choose one. |
| DEP-04 | Label unmatched dependencies "Not found in scanned workspace", not "missing" or "not installed". |
| DEP-05 | Derive reverse dependencies from scanned manifest declarations, preserving conditional and ambiguous status. |
| DEP-06 | Preserve format-3 conditions and label activation "Not evaluated" when no explicit evaluation context exists. Arbitrary expression execution is prohibited. Condition evaluation is not required for MVP. |
| DEP-07 | Show group dependencies and group memberships separately. Do not resolve a group name as an ordinary package name. |

These views are manifest-derived declarations, not a complete or active build
graph. Do not resolve `rosdep` keys, query installed ROS distributions, infer
CMake targets, or present unevaluated conditional edges as definitely active.
Exclude unparseable manifests from semantic indexing and make that limitation
visible. Only usable declared names participate in name-based matching.

### File browsing

| ID | Requirement |
| --- | --- |
| FILE-01 | Browse the selected package directory using a lazy-loaded tree. |
| FILE-02 | Preview common text formats, including XML, launch files, CMake, Python, C++, YAML, and `.msg`, `.srv`, and `.action` definitions. |
| FILE-03 | Limit each preview to 1 MiB. Show an explicit limit message for larger files, and file metadata rather than text for binary files. Enforce the read limit even if a file grows after inspection. |
| FILE-04 | Provide Copy path and Open containing folder actions. |
| FILE-05 | Surface missing, changed, and inaccessible files as explicit states; do not present stale previews as current. |
| FILE-06 | Never execute scripts, launch files, CMake, or other workspace content. |
| FILE-07 | Scope file browsing to the selected package directory and enforce authorized-root checks in the backend, not only the UI. |

### Preferences

Persist only basic local preferences initially: theme, pane sizes, and recent
workspace paths. Do not store workspace source contents in preferences.
Recent workspace paths must be removable. Do not automatically initiate a
scan until the user selects or explicitly reopens a workspace.

## 6. Architecture

```text
React renderer
      |
      | Narrow, typed IPC API
      v
Electron main process
  - Native folder picker
  - Workspace and scan session management
  - Authorized filesystem access
  - Open-folder actions and local preferences
      |
      v
Background worker
  - Recursive discovery
  - XML parsing and manifest validation
  - Package index
  - Dependency index
      |
      v
Local workspace filesystem
```

### Responsibilities and invariants

- The renderer has no direct Node.js or unrestricted filesystem access.
- The main process validates IPC inputs, workspace identity, and path boundaries.
- The worker performs traversal, parsing, and indexing without blocking the UI.
- Every scan has a unique identifier. Late batches, errors, and completion events
  from superseded scans are ignored.
- Switching workspaces cancels the previous scan and clears old selection and
  navigation state. Old results must not appear under the new root.
- Cancellation retains discovered results as explicitly incomplete; switching
  workspaces must not retain the previous workspace's results.
- A format-aware manifest adapter separates XML parsing, semantic validation,
  and normalized presentation.
- Keep discovery, parsing, and validation diagnostics distinct.
- Package identity is manifest location, not the declared package name.
- Use an in-memory index for MVP; no application database or backend server.
- Keep ROS runtime integration out of these components.

Batch progress and result events to avoid flooding the renderer. Load package
directory contents and file previews only when requested.

### Conceptual data model

| Entity | Required information |
| --- | --- |
| Workspace | Authorized root, current scan ID, scan state, counters, diagnostics |
| PackageRecord | Location-based ID, manifest/package paths, relative path, readable original manifest, format, metadata, validation status, ignored/duplicate annotations |
| DependencyDeclaration | Source package ID, original tag, name or group name, normalized categories, version constraints, original condition, evaluation state |
| Diagnostic | Category, severity, affected path, message, optional package ID and source location |

Preserve lists for repeated fields. Make parse failure explicit rather than
constructing a success-shaped package with empty required fields.
Workspace matching is a derived lookup from a dependency name to zero, one,
or multiple package IDs, not a globally unique name foreign key.

## 7. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Responsiveness | Scanning, parsing, and indexing must not block user input. Virtualize large result lists. |
| Search performance | Proposed acceptance target: filtering 5,000 indexed packages within 100 ms on a documented reference machine. Measure event-to-result-state time without deliberately added debounce; report renderer costs separately. |
| Scan performance | Benchmark a representative workspace, recording file/directory/manifest counts, storage, hardware, and cache conditions before defining a scan-time SLA. No unsupported fixed scan-time claim. |
| Offline use | Discovery, metadata, dependencies, and previews work without network access or ROS. |
| Read-only operation | Do not modify workspace files. Local application preferences are allowed outside the workspace. |
| XML safety | Disable DTD/external-entity resolution and external resource loading. Put explicit limits on manifest size and parser resource use; oversized input remains visible with a diagnostic. |
| Renderer isolation | Disable Node integration; enable context isolation and sandboxing. Use a narrow preload bridge, restrictive CSP, and validated IPC. |
| Untrusted content | Render package descriptions as text initially. Never execute manifest markup or file preview content. Load packaged UI assets only. |
| Navigation safety | Block arbitrary renderer navigation and new windows. Open external links only through a validated `http`/`https` action. |
| File boundaries | Validate canonical paths against authorized roots and the selected package scope. Reject traversal and symlink escapes; recheck at the point of access. |
| Accessibility | Keyboard-operable controls, visible focus, accessible labels, sufficient contrast, light/dark themes. |
| Reliability | Expose partial/cancelled scans and individual failures. No broad silent catches or success-shaped fallbacks. |
| Privacy | No telemetry by default and no uploading workspace data. |
| Distribution | Document supported Linux releases and architectures, runtime requirements, installation, and uninstall steps. End users should not need Node.js or developer tools. |

The 1 MiB preview limit is specified. The manifest-size limit is not yet selected;
choose and document a defensible bounded value during parser implementation.
Do not silently omit manifests exceeding that limit.

## 8. Acceptance scenarios

| ID | Scenario and expected result |
| --- | --- |
| ACC-01 | Select a fixture containing a root manifest, nested manifests, hidden directories, generated directories, and `CATKIN_IGNORE`. Every regular-file `package.xml` appears in the default scan; ignored descendants are annotated. |
| ACC-02 | Include malformed XML, unsupported format, an unreadable manifest, and an unreadable subtree. Discovery continues elsewhere; diagnostics distinguish causes, and inaccessible subtrees produce partial status. |
| ACC-03 | Include duplicate package names. Both entries remain visible with distinct paths, and dependency navigation requires disambiguation. |
| ACC-04 | Use format-1, format-2, and format-3 fixtures. Metadata, repeated fields, dependency semantics, constraints, exports, and conditional declarations remain correct. |
| ACC-05 | Declare a dependency absent from the scan. The UI says "Not found in scanned workspace" and makes no installed-system claim. |
| ACC-06 | Declare group dependencies and memberships. They remain distinct from ordinary name-based package matching. |
| ACC-07 | Preview text, binary, oversized, deleted, and unreadable files. Each produces the specified content or explicit state without freezing the UI. |
| ACC-08 | Switch workspaces during an active scan. No late result, error, selection, or completion event from the old scan contaminates the new workspace. |
| ACC-09 | Cancel discovery. It stops cooperatively and labels retained results incomplete. A subsequent refresh completes normally. |
| ACC-10 | Include directory loops and links escaping the root. Symlinks are not followed and skipped links are visible. IPC traversal or unauthorized preview requests are rejected. |
| ACC-11 | Include a manifest with external entities or embedded HTML/script content. No external content is fetched and no script or markup is executed. |
| ACC-12 | Navigate entirely by keyboard, including workspace selection, search, package selection, tabs, dependency navigation, and diagnostics. |
| ACC-13 | Run on a supported clean Linux environment with no ROS, Node.js, or developer tools. Install, launch, scan, inspect, and uninstall successfully. |
| ACC-14 | Filter 5,000 indexed packages. Measure against the search target and record the reference environment and method. |

## 9. Implementation sequence for the next agent

1. Inspect this folder and any applicable repository instructions. This handoff
   does not initialize a Git repository or select dependency versions.
2. Confirm the supported Linux baseline before locking the Electron version.
   Select maintained compatible versions and a package manager; commit its
   lockfile if working in a repository.
3. Scaffold Electron, React, TypeScript, styling, and the isolated preload bridge.
   Establish a launchable shell, native folder selection, and typed IPC.
4. Implement bounded discovery and manifest parsing with focused fixtures and
   tests before coupling them to the UI. Consult the manifest specifications.
5. Add scan lifecycle management, results, diagnostics, search, and selection.
6. Add detail tabs, dependency indexing/navigation, and bounded file previews.
7. Finish keyboard access, themes, local preferences, and required empty/error states.
8. Validate targeted behavior, type-check/build, and produce Linux artifacts.
   Exercise the packaged application, not only a development server.

Keep the first implementation simple. Prefer maintained parser, UI, and
packaging libraries over custom replacements. Do not add runtime ROS features,
an application database, a network service, or unrelated abstractions.

## 10. Validation and definition of done

Use the chosen ecosystem's existing test runner and build tooling. Add focused
automated tests for format-aware parsing, traversal edge cases, duplicates,
dependency matching, scan cancellation/supersession, IPC path authorization,
and preview limits. Add a small UI integration/smoke path for selecting a
workspace and inspecting a package.

The MVP is complete when:

- In-scope requirements are implemented and acceptance scenarios have evidence.
- No workspace content is modified or executed.
- Type-checking and production build succeed.
- A packaged application runs on the documented Linux baseline without ROS.
- Installation, usage, discovery semantics, limits, and known limitations are documented.
- Remaining gaps are reported explicitly rather than described as completed work.

## 11. References

- ROS package manifest format 1, REP-0127:
  https://www.ros.org/reps/rep-0127.html
- ROS package manifest format 2, REP-0140:
  https://www.ros.org/reps/rep-0140.html
- ROS package manifest format 3, REP-0149:
  https://www.ros.org/reps/rep-0149.html
- Electron security:
  https://www.electronjs.org/docs/latest/tutorial/security
- Electron Forge:
  https://www.electronforge.io/

Consult the applicable format specification rather than treating this document
as an exhaustive XML schema. The manifest specifications govern parsing
semantics; this document governs application behavior and scope.
