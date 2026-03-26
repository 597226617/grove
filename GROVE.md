---
contract_version: 3

name: snazzy-humming-thacker

description: Code review loop with coder and reviewer roles

mode: exploration

# Metrics — define measurable objectives.
# Uncomment and configure for evaluation mode.
#
# metrics:
#   metric_name:
#     direction: minimize    # or maximize
#     unit: ""               # optional unit label
#     description: ""        # optional description

# Gates — contribution acceptance rules.
# Uncomment and configure to enforce quality requirements.
#
# gates:
#   - type: metric_improves
#     metric: <metric_name>
#   - type: has_artifact
#     name: <artifact_name>
#   - type: has_relation
#     relation_type: derives_from
#   - type: min_reviews
#     count: 1

# Stop conditions — when to pause work.
#
# stop_conditions:
#   max_rounds_without_improvement: 5
#   target_metric:
#     metric: <metric_name>
#     value: 0.99
#   budget:
#     max_contributions: 100
#     max_wall_clock_seconds: 3600

concurrency:
  max_active_claims: 4
  max_claims_per_agent: 1

execution:
  default_lease_seconds: 300
  max_lease_seconds: 900

agent_topology:
  structure: graph
  roles:
    - name: coder
      description: "Writes and iterates on code"
      prompt: "You are a software engineer. Read the codebase, understand the goal, and write or fix code to accomplish it. After making changes, submit your work as a contribution using grove tools. Check your inbox for reviewer feedback and iterate until the code is solid. Focus on correctness, edge cases, and clean implementation."
      max_instances: 1
      platform: claude-code
      edges:
        - target: reviewer
          edge_type: delegates
    - name: reviewer
      description: "Reviews code and provides feedback"
      prompt: "You are a code reviewer. Watch for new contributions from the coder. Review each one for bugs, security issues, edge cases, and code quality. Submit your review with specific, actionable feedback. If changes are needed, send a message to the coder explaining what to fix. Approve when the code meets quality standards."
      max_instances: 1
      platform: claude-code
      edges:
        - target: coder
          edge_type: feedback
  spawning:
    dynamic: true
    max_depth: 2

# Rate limits — prevent runaway agents.
#
# rate_limits:
#   max_contributions_per_agent_per_hour: 30
#   max_contributions_per_grove_per_hour: 100
#   max_artifact_size_bytes: 10485760
#   max_artifacts_per_contribution: 50

# Retry — backoff configuration for failed operations.
#
# retry:
#   max_attempts: 5
#   base_delay_ms: 10000
#   max_backoff_ms: 300000

# Lifecycle hooks — shell commands run at key points.
#
# hooks:
#   after_checkout: "echo 'Workspace ready'"
#   before_contribute: "bun test"
#   after_contribute: "echo 'Contribution submitted'"
---

# snazzy-humming-thacker

Code review loop with coder and reviewer roles
