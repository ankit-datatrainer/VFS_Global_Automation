/**
 * Candidate CLI — Command-line tool to manage candidates
 * Usage: node src/candidates/cli.js [add|list|edit|delete]
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const Table = require('cli-table3');
const CandidateStore = require('./candidate-store');
const config = require('../../config');

const store = new CandidateStore();

async function addCandidate() {
  console.log(chalk.cyan.bold('\n📝 Add New Candidate\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'fullName',
      message: 'Full Name (as on passport):',
      validate: v => v.length > 2 || 'Name is required',
    },
    {
      type: 'input',
      name: 'passportNumber',
      message: 'Passport Number:',
      validate: v => v.length > 5 || 'Valid passport number required',
    },
    {
      type: 'input',
      name: 'dateOfBirth',
      message: 'Date of Birth (DD/MM/YYYY):',
      validate: v => /^\d{2}\/\d{2}\/\d{4}$/.test(v) || 'Use DD/MM/YYYY format',
    },
    {
      type: 'input',
      name: 'email',
      message: 'Email:',
      validate: v => v.includes('@') || 'Valid email required',
    },
    {
      type: 'input',
      name: 'phone',
      message: 'Phone Number (with country code):',
    },
    {
      type: 'list',
      name: 'preferredCity',
      message: 'Preferred City:',
      choices: Object.entries(config.target.cities).map(([key, val]) => ({
        name: val.name,
        value: key,
      })),
    },
    {
      type: 'number',
      name: 'priority',
      message: 'Priority (1=highest, 10=lowest):',
      default: 5,
    },
    {
      type: 'input',
      name: 'jobStartDate',
      message: 'Job Start Date (optional, DD/MM/YYYY):',
    },
    {
      type: 'input',
      name: 'vfsEmail',
      message: 'VFS Account Email (optional):',
    },
    {
      type: 'password',
      name: 'vfsPassword',
      message: 'VFS Account Password (optional):',
      mask: '*',
    },
    {
      type: 'input',
      name: 'notes',
      message: 'Notes (optional):',
    },
  ]);

  const id = store.addCandidate(answers);
  console.log(chalk.green(`\n✅ Candidate added successfully! ID: ${id}\n`));
}

function listCandidates() {
  const candidates = store.getAllCandidates();

  if (candidates.length === 0) {
    console.log(chalk.yellow('\n📭 No candidates found. Use "add" to add one.\n'));
    return;
  }

  const table = new Table({
    head: [
      chalk.white('ID'),
      chalk.white('Name'),
      chalk.white('Passport'),
      chalk.white('City'),
      chalk.white('Priority'),
      chalk.white('Status'),
      chalk.white('Job Start'),
    ],
    style: { head: [], border: ['grey'] },
  });

  for (const c of candidates) {
    const statusColor = c.bookingStatus === 'booked' ? chalk.green : chalk.yellow;
    table.push([
      c.id,
      c.fullName,
      c.passportNumber.substring(0, 4) + '****',
      config.target.cities[c.preferredCity]?.name || c.preferredCity,
      c.priority,
      statusColor(c.bookingStatus),
      c.jobStartDate || '—',
    ]);
  }

  console.log(chalk.cyan.bold('\n👥 Candidates\n'));
  console.log(table.toString());

  const stats = store.getStats();
  console.log(chalk.grey(`\nTotal: ${stats.total} | Pending: ${stats.pending} | Booked: ${stats.booked}\n`));
}

async function deleteCandidate() {
  const candidates = store.getAllCandidates();
  if (candidates.length === 0) {
    console.log(chalk.yellow('\nNo candidates to delete.\n'));
    return;
  }

  const { id } = await inquirer.prompt([{
    type: 'list',
    name: 'id',
    message: 'Select candidate to delete:',
    choices: candidates.map(c => ({
      name: `${c.id}: ${c.fullName} (${c.passportNumber.substring(0, 4)}****)`,
      value: c.id,
    })),
  }]);

  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: chalk.red('Are you sure? This cannot be undone.'),
    default: false,
  }]);

  if (confirm) {
    store.deleteCandidate(id);
    console.log(chalk.green('\n✅ Candidate deleted.\n'));
  }
}

// Main CLI handler
async function main() {
  store.init();

  const command = process.argv[2] || 'list';

  switch (command) {
    case 'add':
      await addCandidate();
      break;
    case 'list':
      listCandidates();
      break;
    case 'delete':
      await deleteCandidate();
      break;
    default:
      console.log(chalk.cyan(`
Usage: node src/candidates/cli.js [command]

Commands:
  add      Add a new candidate
  list     List all candidates
  delete   Delete a candidate
      `));
  }

  store.close();
}

main().catch(err => {
  console.error(chalk.red(`Error: ${err.message}`));
  store.close();
  process.exit(1);
});
