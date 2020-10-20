# Docserver

A HTTP server to render Markdown docs as HTML using paths relative to a provided directory.

Features soon to come:

* Serve non-markdown files too.
* Git integration, so that it can work on a git repo instead of a local directory.

Build with:

```
bazel build :main
```

[Build and] Run with:

```
bazel run :main -- --dir=$PWD --port=12345           \
  --main_template_html_path=$PWD/main_template.ejs   \
  --error_template_html_path=$PWD/error_template.ejs
```
