load("@build_bazel_rules_nodejs//:index.bzl", "nodejs_binary")

nodejs_binary(
  name = "main",
  entry_point = ":main.js",
  data = [
    "@npm//ejs",
    "@npm//isomorphic-git",
    "@npm//mime-types",
    "@npm//sanitize-html",
    "@npm//showdown",
    "@npm//showdown-highlight",
    "@npm//yargs",
  ],
)
