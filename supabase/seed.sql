-- Mock applicants for demos. Not real people.
insert into leads (contact_id, whatsapp_number, full_name, email, country, programme,
                   has_bachelors_degree, degree_field, has_statistics_course, years_relevant_experience,
                   eligibility_result, foundation_courses, status)
values
  -- Nigerian business graduate: direct entry to the MBA
  ('2348030000001', '+2348030000001', 'Chiamaka Okafor', 'chiamaka.demo@example.com', 'Nigeria', 'MBA',
   true, 'business', null, 2, 'direct_entry', '{}', 'qualified'),
  -- Nigerian engineering graduate, 4 years' experience: FND 5100 likely, waiver can be requested
  ('2348030000002', '+2348030000002', 'Tunde Adeyemi', 'tunde.demo@example.com', 'Nigeria', 'MBA',
   true, 'other', null, 4, 'foundation_likely', '{"FND 5100"}', 'qualified'),
  -- Ghanaian applicant, still enquiring (no published MBA price for Ghana)
  ('233240000003', '+233240000003', 'Kwame Mensah', null, 'Ghana', 'MS Data Analytics',
   true, 'technology', null, 1, null, null, 'enquiring')
on conflict (contact_id) do nothing;
