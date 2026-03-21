#!/usr/bin/env python3
"""Generate a large linear workflow JSON for performance testing."""

import json

BASE_TIME = "2026-03-08T10:00:00Z"


def make_substeps(prefix, count):
  steps = []
  for i in range(count):
    status = "failed" if i > 0 and i % 1003 == 0 else "passed"
    steps.append({
        "id": f"{prefix}-{i}",
        "metadata": {
            "name": f"{prefix.capitalize()} Step {i}",
            "startTime": BASE_TIME,
            "endTime": BASE_TIME,
        },
        "status": status,
        "dependsOn": [f"{prefix}-{i-1}"] if i > 0 else [],
        "logs": f"Running {prefix} step {i}...\nDone.\n",
        "steps": []
    })
  return steps


workflow = {
    "workflow": {
        "metadata": {
            "name": "large-linear-pipeline",
            "uri": "github://org/repo",
            "pin": "abc123",
            "startTime": BASE_TIME,
            "endTime": BASE_TIME,
        },
        "steps": [{
            "id": "checkout",
            "metadata": {
                "name": "Checkout",
                "startTime": BASE_TIME,
                "endTime": BASE_TIME
            },
            "status": "passed",
            "dependsOn": [],
            "logs": None,
            "steps": make_substeps("checkout", 4000)
        }, {
            "id": "build",
            "metadata": {
                "name": "Build",
                "startTime": BASE_TIME,
                "endTime": BASE_TIME
            },
            "status": "passed",
            "dependsOn": ["checkout"],
            "logs": None,
            "steps": make_substeps("build", 2000)
        }, {
            "id": "test",
            "metadata": {
                "name": "Test",
                "startTime": BASE_TIME,
                "endTime": BASE_TIME
            },
            "status": "passed",
            "dependsOn": ["build"],
            "logs": None,
            "steps": make_substeps("test", 5000)
        }]
    }
}

output_path = "large-linear.json"
with open(output_path, "w") as f:
  json.dump(workflow, f, indent=2)

total = 4000 + 2000 + 5000
print(
    f"Generated {output_path} with 3 top-level steps and {total} total sub-steps."
)
