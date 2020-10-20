const ejs = require('ejs');
const fs = require('fs');
const http = require('http');
const path = require('path');
const process = require('process');
const sanitizeHtml = require('sanitize-html');
const showdown = require('showdown');
const showdownHighlight = require('showdown-highlight');
const url = require('url');
const yargs = require('yargs');

// TODO: Add support for using a git repository as the source instead of a
//   (local) directory. Do this by cloning and periodically pulling.

// TODO: Add a LRU cache with adjustable (via flag) size limit in bytes.

const argv = yargs
  .option('port', {
    description: 'TCP port to serve HTTP on.',
    type: 'number',
    default: 80
  })
  .option('dir', {
    description: 'Direcotry to serve from.',
    type: 'string',
    default: '.'
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
        'Path to the main template HTML file which should containt the ' +
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

// TODO: Add some more extensions, like showdown-toc and katex-latex. See this
//   list: https://github.com/showdownjs/showdown/wiki#community
const globalConverter = new showdown.Converter({
  extensions: [showdownHighlight]
});

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

function RespondWithErrorHtml(res, errorCode, msg) {
  const html = tplHtmlErrorCompiled(Object.assign({},{
    title: 'Error',
    errorCode: errorCode,
    msg: msg,
  }));
  res.writeHead(404, {'Content-Type': 'text/html'});
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

function RespondToMarkdown(res, pageTitle, fileContent) {
  try {
    var html = RenderMarkdownHtmlPage(pageTitle, fileContent);
  } catch (e) {
    return RespondWithErrorHtml(res, 500, `Server Error: ${e}`);
  }
  res.writeHead(200, {'Content-Type': 'text/html'});
  return res.end(html);
}

http.createServer(function (req, res) {
  const queryUrl = url.parse(req.url, true);
  const filename = path.join(argv.dir, queryUrl.pathname);
  const basename = path.basename(filename);
  const extension = path.extname(basename).toLowerCase();
  console.log(`Request for: ${filename}`);

  try {
    var fileContent = fs.readFileSync(filename, 'utf8');
  } catch (e) {
    return RespondWithErrorHtml(res, 404, `Can't find: ${queryUrl.pathname}`);
  }

  // TODO: Add support for other file types.
  switch (extension) {
    case ".md":
      RespondToMarkdown(res, basename, fileContent)
      break;
    default:
      return RespondWithErrorHtml(res, 501, `Sorry, I don't know how to treat files ending with extension "${extension}" yet.`);
  }

}).listen(argv.port);
