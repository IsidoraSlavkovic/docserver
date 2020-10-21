const ejs = require('ejs');
const fs = require('fs');
const git = require('isomorphic-git')
const gitHttp = require('isomorphic-git/http/node')
const http = require('http');
const mime = require('mime-types')
const path = require('path');
const process = require('process');
const sanitizeHtml = require('sanitize-html');
const showdown = require('showdown');
const showdownHighlight = require('showdown-highlight');
const url = require('url');
const yargs = require('yargs');

// TODO: Add a LRU cache with adjustable (via flag) size limit in bytes.

const argv = yargs
  .option('port', {
    description: 'TCP port to serve HTTP on.',
    type: 'number',
    default: 80,
  })
  .option('dir', {
    description: 'Directory to clone git to and serve from.',
    type: 'string',
    default: '.',
  })
  .option('git_pull_interval_sec', {
    description: 'Git pulling interval in seconds.',
    type: 'number',
    default: 60,
  })
  .option('git_repo_url', {
    description: 'URL of the Git repository to watch and serve from.',
    type: 'string',
    default: 'https://github.com/IsidoraSlavkovic/docserver.git',
  })
  .option('git_repo_branch', {
    description:
        'The branch to watch. If not specified, the defualt "main branch" ' +
        'of the repository is used.',
    type: 'string',
    default: null,
  })
  .option('git_auth_username', {
    description: 'Git repository credentials - username.',
    type: 'string',
    default: null,
  })
  .option('git_auth_pass', {
    description:
        'Git repository credentials - password. Takes precedence over ' +
        '--git_auth_pass_file.',
    type: 'string',
    default: null,
  })
  .option('git_auth_pass_file', {
    description: 'Git repository credentials - path to a password file.',
    type: 'string',
    default: null,
  })
  .option('main_template_html_path', {
    description:
        'Path to the main template HTML file which should containt the ' +
        'following EJS tags:\n' +
        '<%= title %>            - page title\n' +
        '<%= highlightJsStyle %> - Highlight JS style\n' +
        '<%- mdHtml %>           - markdown HTML content\n',
    type: 'string',
    default: './main_template.ejs'
  })
  .option('error_template_html_path', {
    description:
        'Path to the error template HTML file which should containt the ' +
        'following EJS tags:\n' +
        '<%= title %>     - Page title\n' +
        '<%= errorCode %> - (optional) HTTP error code\n' +
        '<%- msg %>       - Error message to display to the user.\n',
    type: 'string',
    default: './error_template.ejs'
  })
  .option('code_highlight_style', {
    description: 'Highlight JS style, as found in: https://github.com/highlightjs/highlight.js/tree/master/src/styles.',
    type: 'string',
    default: 'vs'
  })
  .help()
  .alias('help', 'h')
  .argv;

// Resolve --dir to an absolute path to use to prefix-match the requested paths
// to avoid exploting docserver to read files outside of --dir.
// ../.././a/b/c 
argv.dir = path.resolve(argv.dir)

class GitRepo {
  // Repo url.
  #url
  // Branch to use.
  #ref
  // Auth object as used by onAuth in git.clone.
  #auth
  // Clone dir.
  #dir

  constructor(url, branch, dir, username, passStr, passFile) {
    this.#url = url;
    this.#ref = branch;
    this.#dir = dir;
    this.#auth = null;
    
    let password = null;
    if (passStr) {
      password = passStr;
    } else if (passFile) {
      try {
        password = fs.readFileSync(passFile, 'utf8');
      } catch (e) {
        console.log(`Failed to read Git password file "${passFile}": ${e}`);
        process.exit(-1);
      }
    }

    if (username || password) {
      this.#auth = Object.assign({},
        username && {username},
        password && {password},
      );
    }
  }

  async clone() {
    console.log(`Cloning git repository: ${this.#url}`);
    try {
      await git.clone({
        fs,
        http: gitHttp,
        onAuth: url => {
          return this.#auth;
        },
        ref: this.#ref,
        dir: this.#dir,
        url: this.#url,
        singleBranch: true,
      });
    } catch(e) {
      console.log(`Failed cloning: ${e}`);
      return false;
    }
    console.log('Done cloning.');
    return true;
  }

  async pull() {
    console.log(`Pulling git repository: ${this.#url}`);
    try {
      await git.pull({
        fs,
        http: gitHttp,
        dir: this.#dir,
        singleBranch: true,
        author: {
          name: this.#auth.username,
        }
      });
    } catch(e) {
      console.log(`Failed pulling: ${e}`);
      return false;
    }
    console.log('Done pulling.');
    return true;
  }
}

function InitGitFromFlagsOrDie() {
  repo = new GitRepo(argv.git_repo_url, argv.git_repo_branch,
  argv.dir, argv.git_auth_username,
  argv.git_auth_pass, argv.git_auth_pass_file);

  if (!repo.clone()) {
    console.log('Nothing to serve, exiting.');
    process.exit(-1);
  }

  setInterval(() => {
    repo.pull();
  }, argv.git_pull_interval_sec * 1000);
}

function InitTemplateOrDie(templateFilePath) {
  try {
    const content = fs.readFileSync(templateFilePath, 'utf8');
    return ejs.compile(content, {async: false});
  } catch (e) {
    console.log(`Failed to initialize template at "${templateFilePath}": ${e}`);
    process.exit(-1);
  }
}

const tplHtmlMainCompiled = InitTemplateOrDie(argv.main_template_html_path);
const tplHtmlErrorCompiled = InitTemplateOrDie(argv.error_template_html_path);

// TODO: Add some more extensions, like showdown-toc and katex-latex. See this
//   list: https://github.com/showdownjs/showdown/wiki#community
const globalConverter = new showdown.Converter({
  extensions: [showdownHighlight]
});

function RespondWithErrorHtml(res, errorCode, msg) {
  const html = tplHtmlErrorCompiled(Object.assign({},{
    title: 'Error',
    errorCode: errorCode,
    msg: msg,
  }));
  res.writeHead(404, {'Content-Type': mime.contentType('text/html')});
  return res.end(html);
}

function RenderMarkdownHtmlPage(pageTitle, markdownStr) {
  const mdHtml = globalConverter.makeHtml(markdownStr);
  const mdHtmlClean = sanitizeHtml(mdHtml, {
    allowedClasses: {
      '*': [ '*' ]
    }
  });
  return tplHtmlMainCompiled({
    title: pageTitle,
    mdHtml: mdHtmlClean,
    highlightJsStyle: argv.code_highlight_style,
  });
}

function RespondWithValidFileContent(res, filename, fileContent) {
  const mimeType = mime.lookup(filename)
  const basename = path.basename(filename);

  switch (mimeType) {
    case "text/markdown":
      try {
        var html = RenderMarkdownHtmlPage(
          basename, fileContent.toString('utf-8'));
      } catch (e) {
        return RespondWithErrorHtml(res, 500, `Server Error: ${e}`);
      }
      res.writeHead(200, {'Content-Type': mime.contentType('text/html')});
      return res.end(html);
    default:
      // Respond raw.
      res.writeHead(200, {'Content-Type': mime.contentType(mimeType)});
      return res.end(fileContent);
  }
}

InitGitFromFlagsOrDie();

http.createServer(function (req, res) {
  const queryUrl = url.parse(req.url, true);
  // argv.dir is absolute path here thanks to path.resolve above.
  const filename = path.join(argv.dir, queryUrl.pathname);
  console.log(`Request for: ${filename}`);

  // This is a check to avoid the following situation:
  //  argv.dir: /a/b/c
  //  queryUrl: ../../../etc/passwd
  //  filename: /etc/passwd
  if (!filename.startsWith(argv.dir)) {
    return RespondWithErrorHtml(res, 403, `Hey! That's forbidden, play nice!`); 
  }

  try {
    var fileContent = fs.readFileSync(filename);
  } catch (e) {
    return RespondWithErrorHtml(res, 404, `Can't find: ${queryUrl.pathname}`);
  }

  return RespondWithValidFileContent(res, filename, fileContent)

}).listen(argv.port);
