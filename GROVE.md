---
contract_version: 3

name: drifting-cooking-lerdorf

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

agent_constraints:
  required_artifacts:
    work: ["diff.patch"]
  required_relations:
    review: ["reviews"]

evaluation:
  required_context: ["pr_number", "branch"]

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
      prompt: "You are the coder. Create src/hello.ts that exports a greet(name: string) function returning a greeting string. Keep it under 20 lines. After creating the file, call grove_contribute kind=discussion with agent: {role: 'coder'} and a summary of what you did. Then call grove_done with agent: {role: 'coder'}."
      max_instances: 1
      command: "claude"
      edges:
        - target: reviewer
          edge_type: delegates
    - name: reviewer
      description: "Reviews code and provides feedback"
      prompt: "You are the reviewer. You will receive messages from the system when the coder submits work. When you receive a message about new work, review the code quality, then call grove_contribute kind=discussion with agent: {role: 'reviewer'} and your review summary, then grove_done with agent: {role: 'reviewer'}. Wait for a message before doing anything."
      max_instances: 1
      command: "claude"
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

# drifting-cooking-lerdorf

Code review loop with coder and reviewer roles
