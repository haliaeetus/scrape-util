const path = require('path');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs-extra'));
const request = require('request-promise');
const _ = require('lodash');

const jsdom = require('jsdom').jsdom;

const document = jsdom('<html></html>', {});
const window = document.defaultView;
const $ = require('jquery')(window);

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
  return ({ data, headers }) => {
    return Promise.map(formatsFn(data, headers), renderFormat(outputDir, filePrefix));
  };
}

function getHTML(url, transform = $) {
  return () => {
    return request({
      uri: url,
      transform
    });
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

function parseTableAfterSentinel($html, selector, parseIndices, parsers) {
  const $sentinel = $html.find(selector);
  if (!$sentinel.length) {
    throw new Error(`Sentinel ${selector} not found`);
  }
  const $table = $sentinel.nextRelative('table');
  if (!$table.length) {
    throw new Error(`No table found after ${selector}`);
  }

  return parseTable($table, parseIndices, parsers);
}

const logger = msg => data => {
  console.log(msg);
  return data;
};

module.exports = {
  renderFiles,
  getHTML,
  parseElements,
  parseTable,
  parseTableAfterSentinel,
  logger,
  $
};
