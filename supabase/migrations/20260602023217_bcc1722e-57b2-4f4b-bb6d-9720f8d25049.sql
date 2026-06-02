-- Revert Stripe webhook simulation test data
UPDATE public.invoices
  SET status = 'scheduled',
      paid_at = NULL,
      stripe_payment_intent_id = NULL,
      payment_method_last4 = NULL,
      updated_at = now()
WHERE id = 'a7237738-50ed-484b-b76d-617969e80148';

DELETE FROM public.payment_attempts
WHERE stripe_event_id IN ('evt_test_sim_1780367490775', 'evt_test_sim_mismatch_1780367492351');

DELETE FROM public.messages
WHERE content = 'Payment received: Final — $5,250.00'
  AND sender_id IS NULL
  AND created_at > now() - interval '15 minutes';

DELETE FROM public.notifications
WHERE kind IN ('payment_received', 'payment_mismatch')
  AND created_at > now() - interval '15 minutes'
  AND (
    title = 'Payment received — $5,250.00'
    OR body LIKE 'Stripe reported 5251.%'
  );