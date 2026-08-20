-- Add Beatriz Desyatnyuk, paid application FK-U8FFN-K4N
--
-- INSERT OR IGNORE, not OR REPLACE: if this reference somehow already exists,
-- doing nothing is safer than silently overwriting a real record.
--
-- amount_total is in cents, so 100 is the EUR 1.00 confirmation.

INSERT OR IGNORE INTO applications
  (id, reference, status, name, email, payload, letter,
   amount_total, currency, created_at, paid_at, notified_at, applicant_emailed_at)
VALUES (
  'e1c3bc5e-4853-43e7-a6f3-c88104a6064e',
  'FK-U8FFN-K4N',
  'paid',
  'Beatriz Desyatnyuk',
  'bettyuk25@gmail.com',
  '{"name": "Beatriz Desyatnyuk", "email": "bettyuk25@gmail.com", "phone": "+31657759460", "city": "Maastricht", "employment": "permanent", "role": "Waitress", "organisation": "Sweet Coffee", "income": 2300, "budget": 800, "months_in_advance": "1", "household": "single", "available_from": "2026-09-01", "duration": "an indefinite period", "personality": ["clean", "respectful", "responsible", "sociable"], "hobbies": "I enjoy watching movies on rainy nights, but in the other hand if there’s sun you’ll see me going to all the beautiful Cafés and enjoying the sun."}',
  'Hi,

My name is Beatriz Desyatnyuk and I would like to schedule a viewing at your earliest convenience.

Financial:
- Waitress at Sweet Coffee, permanent contract
- Monthly income: €2.300 / Budget: €800
- Willing to pay 1 month rent in advance to secure the apartment

Personal:
- Single
- Available from: 1 September 2026
- Looking for an indefinite period
- No pets, non-smoker, no musical instruments

About me:
- Personality: clean, respectful, responsible, sociable
- Hobbies / lifestyle: I enjoy watching movies on rainy nights, but in the other hand if there’s sun you’ll see me going to all the beautiful Cafés and enjoying the sun.

All necessary documents are prepared and available upon request.

Best regards,
Beatriz Desyatnyuk
bettyuk25@gmail.com
+31657759460',
  100,
  'eur',
  '2026-08-19T12:00:00Z',
  '2026-08-19T12:00:00Z',
  NULL,
  NULL
);

SELECT reference, status, name, email, amount_total
  FROM applications WHERE reference = 'FK-U8FFN-K4N';
