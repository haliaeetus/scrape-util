const path = require('path');
const url = require('url');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs-extra'));
const request = require('request-promise');
const _ = require('lodash');

const jsdom = require('jsdom').jsdom;

const document = jsdom('<html></html>', {});
const window = document.defaultView;
const $ = require('jquery')(window);

const iconv = require('iconv-lite');

// search for single element matching selector
// first search siblings after element, then siblings after element's parent, then grandparent, etc.
$.fn.nextRelative = function nextRelative(selector) {
  return this.map(function nextRelativeSingle() {
    let $elem = $(this);

    while ($elem.length) {
      const $nextCandidate = $elem.nextAll(selector).first();
      if ($nextCandidate.length) {
        return $nextCandidate.get(0);
      }
      $elem = $elem.parent();
    }

    return null;
  });
};

function renderFormat(outputDir, filePrefix) {
  return ({ ext, data, serializer }) => fs.writeFileAsync(path.join(outputDir, `${filePrefix}${ext}`), serializer(data));
}

function renderFiles(formatsFn, filePrefix, outputDir) {
  // eslint-disable-next-line arrow-body-style
  return (data) => {
    return Promise.map(formatsFn(data), renderFormat(outputDir, filePrefix));
  };
}

function getHTML(url, { transform = $, encoding = 'utf8' }) {
  return () => {
    return request({
      uri: url,
      encoding: null
    })
    .then(res => {
      return iconv.decode(new Buffer(res), encoding);
    })
    .then(transform);
  };
}

function basicElementParser($elem) {
  return $elem.text().trim();
}

function parseElements($elems, keys, parsers = {}, defaultParser = basicElementParser) {
  const result = {};
  _.each(keys, (index, key) => {
    const parser = parsers[key] || defaultParser;
    result[key] = parser($elems.eq(index));
  });
  return result;
}

function parseTable($table, parseIndices, parsers, parser) {
  const $rows = $table.find('tbody').find('tr').slice(1);

  return $rows.toArray().map(row => {
    return parseElements($(row).children(), parseIndices, parsers, parser);
  });
}

const logger = msg => data => {
  console.log(msg);
  return data;
};

const libraries = {
  $: {
    transforms: {
      init: () => $,
      absolutifyUrls: (pageConfig) => {
        return function absolutifyUrls($html) {
          const baseUrl = pageConfig.url;
          $html.find('a').each(function () {
            const $elem = $(this);
            const href = $elem.attr('href');
            if (!href || href.charAt(0) === '#') {
              return;
            }
            $elem.attr('href', url.resolve(baseUrl, href));
          });

          return $html;
        };
      }
    },
    parsers: {
      table({ selector, parseIndices, parsers, rowParser, key }) {
        return ($html) => {
          const $table = selector($html);
          const entries = parseTable($table, parseIndices, parsers).map(rowParser);
          return key ? _.keyBy(entries, key) : entries;
        };
      }
    }
  }
};

function parseHtml(parserConfigs, library) {
  const parsers = library.parsers;
  return $html => {
    return Promise.mapSeries(parserConfigs, parserConfig => {
      const { name, type, options, postParse, preParse } = parserConfig;
      const parser = type === 'custom' ? parserConfig.parser : parsers[type];
      if (!parser) {
        throw new Error(`No parser for ${type}`);
      }

      return Promise.resolve($html)
      .then(data => {
        return (preParse || _.identity)(data);
      })
      .then(parser(options))
      .then(data => {
        return (postParse || _.identity)(data);
      })
      .then(logger(`  Parsed ${name}`));
    }).then(values => {
      return _.zipObject(_.map(parserConfigs, 'id'), values);
    });
  };
}

function scrapePage(page) {
  const library = libraries[page.libraryId || '$'];
  // todo: abstract this
  const transforms = libraries.$.transforms;
  const { url, name, parsers, encoding, } = page;
  console.log(`Requesting ${name} HTML`);
  return getHTML(url, { encoding, transform: _.identity })()
    .then(logger(`Retrieved ${name} HTML.`))
    .then($html => {
      let transforms = page.transforms;
      if (!transforms) {
        transforms = ['init'];
      }

      return transforms.reduce((transformee, transform) => {
        if (_.isString(transform)) {
          transform = library.transforms[transform];
        }
        return transform(page)(transformee);
      }, $html);
    })
    .then(logger(`Transformed ${name} HTML`))
    .then(parseHtml(parsers, library));
}

function scrapePages(pages) {
  return Promise.mapSeries(pages, scrapePage)
  .then(values => {
    return _.zipObject(_.map(pages, 'id'), values);
  });
}

module.exports = {
  renderFiles,
  getHTML,
  parseElements,
  parseTable,
  logger,
  scrapePages,
  libraries,
  $
};
