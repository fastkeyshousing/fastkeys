/* Turning a Stripe decline into something the applicant can act on.
 *
 * The codes themselves are useless to a person: "generic_decline" tells them
 * nothing, and their bank will not discuss the reason with us because for
 * privacy reasons issuers only explain declines to their own cardholder. So each
 * code maps to the most likely cause and, more importantly, to the next thing
 * worth trying.
 *
 * Nothing here is shown as certainty. The honest position with most declines is
 * "your bank refused and did not say why", and pretending otherwise sends people
 * chasing the wrong fix. */

const DECLINES = {
  generic_decline: {
    title: 'Your bank refused the payment',
    detail:
      'They did not tell us why, and for privacy reasons they will only discuss it with you. ' +
      'On a European debit card this is very often because online or foreign payments are ' +
      'switched off by default.',
    fixes: [
      'Try a credit card instead of a debit card if you have one',
      'Check your banking app for a blocked-payment notification, many banks let you approve it there',
      'Call the number on the back of your card and ask them to allow this payment',
    ],
  },
  insufficient_funds: {
    title: 'Not enough available balance',
    detail: 'The card was refused for want of funds. Some banks also count pending transactions against your balance.',
    fixes: ['Try another card', 'Try again once the balance has cleared'],
  },
  card_velocity_exceeded: {
    title: 'Too many attempts in a short time',
    detail: 'Your bank has temporarily blocked further tries on this card. This clears on its own.',
    fixes: ['Wait about thirty minutes and try again', 'Or use a different card now'],
  },
  do_not_honor: {
    title: 'Your bank refused the payment',
    detail: 'A general refusal from the issuer, usually a risk rule on their side rather than anything wrong with the card.',
    fixes: ['Try a different card', 'Ask your bank to allow the payment, then try again'],
  },
  lost_card: { title: 'This card cannot be used', detail: 'The issuer has reported this card as lost or stolen.', fixes: ['Use a different card'] },
  stolen_card: { title: 'This card cannot be used', detail: 'The issuer has reported this card as lost or stolen.', fixes: ['Use a different card'] },
  expired_card: { title: 'That card has expired', detail: 'The expiry date has passed.', fixes: ['Use a current card'] },
  incorrect_cvc: { title: 'The security code did not match', detail: 'The three digits on the back of the card were not accepted.', fixes: ['Check the code and try again'] },
  incorrect_number: { title: 'The card number was not accepted', detail: 'One of the digits appears to be wrong.', fixes: ['Check the long number and try again'] },
  processing_error: {
    title: 'Something went wrong at the bank',
    detail: 'A temporary fault while the payment was being processed. Nothing was charged.',
    fixes: ['Try again in a few minutes', 'Use a different card if it happens twice'],
  },
  authentication_required: {
    title: 'Your bank needs to verify it is you',
    detail: 'The payment needs confirming in your banking app or by the code your bank sends.',
    fixes: ['Try again and complete the verification step', 'Have your phone to hand'],
  },
  card_not_supported: {
    title: 'This card cannot be used for this kind of payment',
    detail: 'Common with some prepaid and gift cards, which many banks block for online purchases.',
    fixes: ['Use a normal debit or credit card'],
  },
  currency_not_supported: {
    title: 'This card cannot pay in euro',
    detail: 'The card is not enabled for euro transactions.',
    fixes: ['Use a card that supports euro payments'],
  },
  payment_intent_redirect_payment_method_failure: {
    title: 'That payment method did not complete',
    detail: 'The redirect to your bank or wallet did not finish. This often happens if the window was closed early or the app did not open.',
    fixes: ['Try again and stay on the page until it returns', 'Or pay by card instead'],
  },
};

/* Radar blocking is not a decline. Saying "your bank refused" here would be a
 * lie, and the applicant would waste a phone call finding that out. */
const BLOCKED = {
  title: 'Our payment provider stopped further attempts',
  detail:
    'After a few failed tries in a row, Stripe pauses additional attempts on a card as a routine ' +
    'safety precaution. It is automatic, it is not a judgement about you, and it clears by itself.',
  fixes: [
    'Wait about thirty minutes, then try again',
    'Or use a different card straight away',
    'If neither works, email us and we will send you a payment link by another route',
  ],
};

const UNKNOWN = {
  title: 'The payment did not go through',
  detail: 'Nothing was charged. We were not told why it failed.',
  fixes: ['Try again, or use a different card', 'If it keeps failing, email us and we will sort it out'],
};

/* `code` is the Stripe decline_code, `type` distinguishes a bank decline from a
 * Radar block. Returns a shape the page can render directly. */
export function explainDecline({ declineCode, failureType } = {}) {
  if (failureType === 'blocked') return { code: 'blocked', ...BLOCKED };
  if (declineCode && DECLINES[declineCode]) return { code: declineCode, ...DECLINES[declineCode] };
  return { code: declineCode || 'unknown', ...UNKNOWN };
}
