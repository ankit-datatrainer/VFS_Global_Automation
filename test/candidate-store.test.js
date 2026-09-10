/**
 * Test: Candidate Store — Encryption and CRUD operations
 */

const CandidateStore = require('../src/candidates/candidate-store');

// Set a test master password
process.env.MASTER_PASSWORD = 'test_password_12345';

const store = new CandidateStore();

console.log('\n🧪 Testing Candidate Store...\n');

try {
  // Initialize
  store.init();
  console.log('✅ Database initialized');

  // Add a test candidate
  const id = store.addCandidate({
    fullName: 'Test Applicant',
    passportNumber: 'A1234567',
    dateOfBirth: '15/06/1990',
    email: 'test@example.com',
    phone: '+919876543210',
    preferredCity: 'delhi',
    priority: 3,
    jobStartDate: '01/12/2026',
    vfsEmail: 'test@vfs.com',
    vfsPassword: 'test_vfs_pass',
    notes: 'Test candidate for validation',
  });
  console.log(`✅ Candidate added with ID: ${id}`);

  // Retrieve and verify decryption
  const candidate = store.getCandidate(id);
  console.log(`✅ Retrieved candidate: ${candidate.fullName}`);

  // Verify encryption works
  const assertions = [
    ['Full Name', candidate.fullName, 'Test Applicant'],
    ['Passport', candidate.passportNumber, 'A1234567'],
    ['DOB', candidate.dateOfBirth, '15/06/1990'],
    ['Email', candidate.email, 'test@example.com'],
    ['Phone', candidate.phone, '+919876543210'],
    ['VFS Email', candidate.vfsEmail, 'test@vfs.com'],
    ['VFS Password', candidate.vfsPassword, 'test_vfs_pass'],
    ['City', candidate.preferredCity, 'delhi'],
    ['Priority', candidate.priority, 3],
  ];

  let passed = 0;
  let failed = 0;

  for (const [name, actual, expected] of assertions) {
    if (actual === expected) {
      console.log(`  ✅ ${name}: ${actual}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}: expected "${expected}", got "${actual}"`);
      failed++;
    }
  }

  // Test get all candidates
  const all = store.getAllCandidates();
  console.log(`\n✅ All candidates: ${all.length} found`);

  // Test stats
  const stats = store.getStats();
  console.log(`✅ Stats: ${JSON.stringify(stats)}`);

  // Test update
  store.updateBookingStatus(id, 'booked', 'REF-123', '2026-09-15');
  const updated = store.getCandidate(id);
  console.log(`✅ Updated status: ${updated.bookingStatus} (ref: ${updated.bookingReference})`);

  // Cleanup: delete test candidate
  store.deleteCandidate(id);
  console.log(`✅ Test candidate deleted`);

  // Final result
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(50)}\n`);

  if (failed > 0) process.exit(1);

} catch (error) {
  console.error(`\n❌ Test failed: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
} finally {
  store.close();
}
