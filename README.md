# Docserver

A HTTP server to render Markdown docs as HTML using paths relative to a provided
Git repository which is cloned and periodically pulled. Files other than
markdown are served raw.

Build with:

```
bazel build :main
```

[Build and] Run with:

```
bazel run :main -- --dir=/tmp/clone_here --port=12345                \
  --main_template_html_path=$PWD/main_template.ejs                   \
  --error_template_html_path=$PWD/error_template.ejs                 \
  --git_repo_url="https://github.com/IsidoraSlavkovic/docserver.git" \
  --git_pull_interval_sec=60                                         \
  --git_auth_username="whatever"
```
