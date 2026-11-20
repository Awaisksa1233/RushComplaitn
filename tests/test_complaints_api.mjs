import express from 'express';
import complaintsRouter from '../server/routes/complaintsRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/complaints', complaintsRouter);

async function runTests() {
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/complaints`;

  try {
    console.log(`[Complaints Test] Server running on port ${port}`);

    // Test 1: Verify missing fields
    const res1 = await fetch(`${baseUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    console.log(`Test 1 (missing fields): status=${res1.status} (expected 400)`);
    if (res1.status !== 400) throw new Error('Test 1 failed');

    // Test 2: Verify with plate and phone
    const res2 = await fetch(`${baseUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '0555123456',
        plate: 'أ ب ج 1234'
      })
    });
    const data2 = await res2.json();
    console.log(`Test 2 (verify plate/phone): status=${res2.status}, success=${data2.success}`);
    console.log(`  - Normalized plate: ${data2.verifiedCustomer?.normalizedPlate}`);
    console.log(`  - Standard phone: ${data2.verifiedCustomer?.phone}`);
    console.log(`  - Duplicate found: ${data2.duplicateFound}`);
    if (!data2.success) throw new Error('Test 2 failed');

    // Test 3: Upload URL generation
    const res3 = await fetch(`${baseUrl}/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'damage_front.jpg',
        fileType: 'image/jpeg',
        fileSize: 1024 * 1024
      })
    });
    const data3 = await res3.json();
    console.log(`Test 3 (upload URL): status=${res3.status}, fileKey=${data3.fileKey}`);
    if (!data3.success || !data3.fileKey) throw new Error('Test 3 failed');

    // Test 4: Submit a test complaint
    const testPlate = `TEST-${Math.floor(1000 + Math.random() * 9000)}`;
    const res4 = await fetch(`${baseUrl}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '0555987654',
        vehiclePlate: testPlate,
        branch: 'al-kharj',
        bay: 'tunnel-1',
        category: 'damage',
        affectedParts: ['hood_bumper'],
        description: 'خدش بسيط في الصدام الأمامي أثناء دخول النفق',
        customerName: 'عميل تجريبي'
      })
    });
    const data4 = await res4.json();
    console.log(`Test 4 (submit complaint): status=${res4.status}, ticketCode=${data4.ticketCode}`);
    if (!data4.success || !data4.ticketCode) throw new Error('Test 4 failed');

    // Test 5: Track the created ticket
    const res5 = await fetch(`${baseUrl}/${data4.ticketCode}`);
    const data5 = await res5.json();
    console.log(`Test 5 (track ticket): status=${res5.status}, category=${data5.complaint?.category}`);
    if (!data5.success || data5.complaint?.ticketCode !== data4.ticketCode) throw new Error('Test 5 failed');

    // Test 6: Verify duplicate prevention on the same plate
    const res6 = await fetch(`${baseUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '0555987654',
        plate: testPlate
      })
    });
    const data6 = await res6.json();
    console.log(`Test 6 (duplicate prevention check): duplicateFound=${data6.duplicateFound}, existingTicket=${data6.existingTicket?.ticketCode}`);
    if (!data6.duplicateFound) throw new Error('Test 6 failed: Duplicate was not detected');

    console.log('\n✅ ALL 6 BACKEND COMPLAINTS API TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('❌ Test runner failed:', err);
  process.exit(1);
});
