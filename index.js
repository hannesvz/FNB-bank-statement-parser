const fs = require('fs');

const child_process = require('child_process');

const path = require('path');

const util = require('util');

const exec = util.promisify(child_process.exec);

const months = {
  'Jan': '01',
  'Feb': '02',
  'Mar': '03',
  'Apr': '04',
  'May': '05',
  'Jun': '06',
  'Jul': '07',
  'Aug': '08',
  'Sep': '09',
  'Oct': '10',
  'Nov': '11',
  'Dec': '12',
}

// Parse a single statement PDF and return an array of transaction records,
// each { date: 'YYYY-MM-DD', row: '"date","desc",amount' }.
async function parseFile(file) {
  let tmpfile = '/tmp/outputfile-' + path.basename(file) + '-' + process.pid;
  await exec(__dirname + '/bin/pdftotext -table "' + file + '" "' + tmpfile + '"');

  var text = fs.readFileSync(tmpfile).toString().split('\n');
  fs.unlinkSync(tmpfile);

  var lines = text.filter((l) => l.match(/^\d\d\s/)).slice(0, -5); // all lines except last 5

  var yearline = text.find((l) => /Statement\ Date/.test(l)).split(' ');
  var year = yearline.filter((k) => k).slice(-1)[0];

  var records = [];

  for (let i = 0; i < lines.length; i++) {
    let line = [];

    // get the month
    let month = months[lines[i].split('  ')[1]]

    // get the date
    let date = year + '-' + month + '-' + lines[i].split('  ')[0];
    line.push('"' + date + '"');

    // get the description
    let amountstrip = lines[i].split('  ').filter((l) => l).slice(-3); // check from the end, and isolate the amount from the last two fields
    let amountindex = amountstrip.findIndex((k) => /[\d,]+\.\d{2}/.test(k));
    let amount = amountstrip[amountindex].trim();
    let amountindex2 = lines[i].lastIndexOf(amount);
    let desc = lines[i].slice(8, amountindex2).split('  ');
    let desccombined = desc.filter((l) => l).join(' ').trim();
    line.push('"' + desccombined + '"');

    // get the amount: strip thousands separators and an optional "Cr" suffix
    // (with or without a leading space). "Cr" means credit -> positive,
    // otherwise it is a debit -> negative.
    let rawamount = amount.replace(/,/g, '').trim();
    let isCredit = /\s*Cr$/.test(rawamount);
    let numeric = rawamount.replace(/\s*Cr$/, '').trim();
    let signedamount = (isCredit ? '' : '-') + numeric;
    line.push(signedamount); // unquoted -> pure number in the CSV

    records.push({ date: date, row: line.join(',') });
  }

  return records;
}

async function main() {
  let files = process.argv.slice(2).map((f) => path.resolve(f));
  if (files.length === 0) {
    console.log('Usage: node index.js <statement.pdf> [statement2.pdf ...]');
    process.exit(1);
  }

  let records = [];
  for (let file of files) {
    try {
      records = records.concat(await parseFile(file));
    } catch (error) {
      console.log('An error occurred parsing ' + file + ': ', error);
    }
  }

  if (records.length === 0) {
    console.log('No transactions found.');
    return;
  }

  // sort chronologically so the output (and the date range) is ordered
  records.sort((a, b) => a.date.localeCompare(b.date));

  let startDate = records[0].date;
  let endDate = records[records.length - 1].date;

  // single file keeps its original name; multiple files are combined into one
  // file named with the overall date range.
  let outfile;
  if (files.length === 1) {
    outfile = files[0].replace(path.extname(files[0]), '') + '.csv';
  } else {
    outfile = path.join(path.dirname(files[0]), 'statements_' + startDate + '_to_' + endDate + '.csv');
  }

  fs.writeFileSync(outfile, records.map((r) => r.row).join('\n'));
  console.log('Done! ' + records.length + ' transactions (' + startDate + ' to ' + endDate + ') -> ' + outfile);
}

main();
