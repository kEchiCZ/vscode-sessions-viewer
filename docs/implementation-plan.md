# VS Code Sessions Viewer Implementation Plan

This project implements the plan from `plan.md`: a minimal local web app that lists Copilot/VS Code chat sessions by reading local VS Code Copilot Chat artifacts from disk.

The MVP uses a Node/Express backend with a source abstraction. The first source scans local transcript and debug-log JSONL files under VS Code `workspaceStorage`, normalizes cheap metadata, keeps an in-memory cache, and refreshes through file watching plus periodic polling. The frontend is a compact Vite + React + TypeScript UI with dark HolecAI styling.

Chronicle and `session_store_sql` concepts from `skiller.md` guide the metadata shape, but the app does not call internal assistant tools directly. Future sources can be added behind the same backend source contract.
