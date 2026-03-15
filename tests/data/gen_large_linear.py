#!/usr/bin/env python3
"""Generate a large linear workflow JSON for performance testing."""

import json

BASE_TIME = "2026-03-08T10:00:00Z"

def make_substeps(prefix, count):
    steps = []
    for i in range(count):
        steps.append({
            "id": f"{prefix}-{i}",
            "name": f"{prefix.capitalize()} Step {i}",
            "status": "passed",
            "startTime": BASE_TIME,
            "endTime": BASE_TIME,
            "dependsOn": [f"{prefix}-{i-1}"] if i > 0 else [],
            "logs": f"Running {prefix} step {i}...\nDone.\n",
            "steps": []
        })
    return steps

workflow = {
    "workflow": {
        "name": "large-linear-pipeline",
        "metadata": {
            "repository": "org/repo",
            "branch": "main",
            "commit": "abc123"
        },
        "steps": [
            {
                "id": "checkout",
                "name": "Checkout",
                "status": "passed",
                "startTime": BASE_TIME,
                "endTime": BASE_TIME,
                "dependsOn": [],
                "logs": None,
                "steps": make_substeps("checkout", 4000)
            },
            {
                "id": "build",
                "name": "Build",
                "status": "passed",
                "startTime": BASE_TIME,
                "endTime": BASE_TIME,
                "dependsOn": ["checkout"],
                "logs": None,
                "steps": make_substeps("build", 2000)
            },
            {
                "id": "test",
                "name": "Test",
                "status": "passed",
                "startTime": BASE_TIME,
                "endTime": BASE_TIME,
                "dependsOn": ["build"],
                "logs": None,
                "steps": make_substeps("test", 5000)
            }
        ]
    }
}

output_path = "large-linear.json"
with open(output_path, "w") as f:
    json.dump(workflow, f, indent=2)

total = 4000 + 2000 + 5000
print(f"Generated {output_path} with 3 top-level steps and {total} total sub-steps.")
