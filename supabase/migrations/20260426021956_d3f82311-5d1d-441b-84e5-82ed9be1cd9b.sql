INSERT INTO public.messages (conversation_id, sender_id, content, is_internal_note, created_at) VALUES
('21a8bd77-9e27-4829-a43c-69edaddec076', '15f705ca-8003-467d-8b38-48b1795a6ba3', 'So glad we got to meet today! Excited to be part of your wedding.', false, now() - interval '3 days'),
('21a8bd77-9e27-4829-a43c-69edaddec076', '56fb7740-2dde-4d64-a565-3ddd0c0afd89', 'Sending contract draft tomorrow after Victoria reviews.', true, now() - interval '2 days'),
('21a8bd77-9e27-4829-a43c-69edaddec076', '15f705ca-8003-467d-8b38-48b1795a6ba3', 'Reminder — engagement session prompt goes out in 3 weeks.', false, now() - interval '1 day'),
('5767bbb9-d291-4182-9e78-6254669d101d', '56fb7740-2dde-4d64-a565-3ddd0c0afd89', 'Hi Charlotte! Just a heads up your logistics form will arrive next week.', false, now() - interval '6 hours'),
('523a7c3d-b243-4703-a901-233de5534479', '1be192e8-ee0d-48c1-b7d2-d94b08a52c6d', 'Wedding 5 weeks out — vendor confirms in progress.', true, now() - interval '5 hours'),
('523a7c3d-b243-4703-a901-233de5534479', '15f705ca-8003-467d-8b38-48b1795a6ba3', 'Counting down with you! Let me know if you have any questions.', false, now() - interval '2 hours');