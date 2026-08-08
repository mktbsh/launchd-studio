export const DEFAULT_MANIFEST_SOURCE = `{
  "$schema": "./launchd-studio.schema.json",
  "version": 1,
  "jobs": {
    "local-api": {
      "kind": "service",
      "label": "dev.example.local-api",
      "description": "Local development API",
      "comment": "Long-running process. No shell is inserted around this command.",
      "command": [
        "/opt/homebrew/bin/bun",
        "run",
        "src/index.ts"
      ],
      "workingDirectory": "~/src/local-api",
      "start": "login",
      "restart": "on-failure",
      "environment": {
        "NODE_ENV": "development"
      }
    },
    "daily-backup": {
      "kind": "task",
      "label": "dev.example.daily-backup",
      "comment": "Finite job. Calendar fields omitted from an entry act as wildcards.",
      "command": [
        "~/.local/bin/backup"
      ],
      "schedule": {
        "type": "calendar",
        "entries": [
          {
            "hour": 3,
            "minute": 0
          }
        ]
      }
    }
  }
}
`;
