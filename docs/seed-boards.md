# Board Seed Data for Padvik

## Phase 1 Boards (MVP Priority)

```json
[
  {
    "code": "CBSE",
    "name": "CBSE",
    "full_name": "Central Board of Secondary Education",
    "state": null,
    "website_url": "https://www.cbse.gov.in",
    "syllabus_url": "https://cbseacademic.nic.in/curriculum_2026.html",
    "metadata": {
      "type": "national",
      "grading": "9-point",
      "medium": ["english", "hindi"],
      "textbooks": "NCERT",
      "exam_months": ["february", "march"],
      "approx_schools": 27000,
      "approx_students_millions": 18
    }
  },
  {
    "code": "ICSE",
    "name": "ICSE",
    "full_name": "Indian Certificate of Secondary Education (Council for the Indian School Certificate Examinations)",
    "state": null,
    "website_url": "https://www.cisce.org",
    "syllabus_url": "https://www.cisce.org/publications.aspx",
    "metadata": {
      "type": "national",
      "grading": "percentage",
      "medium": ["english"],
      "textbooks": "Multiple publishers",
      "exam_months": ["february", "march"],
      "note": "ISC for classes 11-12",
      "approx_schools": 2600,
      "approx_students_millions": 2.5
    }
  },
  {
    "code": "KL_SCERT",
    "name": "Kerala State Board",
    "full_name": "State Council of Educational Research and Training, Kerala",
    "state": "Kerala",
    "website_url": "https://scert.kerala.gov.in",
    "syllabus_url": "https://scert.kerala.gov.in/curriculum",
    "metadata": {
      "type": "state",
      "grading": "grade-based",
      "medium": ["english", "malayalam"],
      "textbooks": "SCERT Kerala",
      "exam_months": ["march"],
      "hse_board": "dhsekerala.gov.in",
      "approx_students_millions": 4
    }
  }
]
```

## Phase 2 Boards (Top State Boards by Student Volume)

```json
[
  {
    "code": "KA_KSEAB",
    "name": "Karnataka State Board",
    "full_name": "Karnataka School Examination and Assessment Board",
    "state": "Karnataka",
    "website_url": "https://kseab.karnataka.gov.in",
    "metadata": { "type": "state", "medium": ["english", "kannada"], "approx_students_millions": 8.5 }
  },
  {
    "code": "TN_DGE",
    "name": "Tamil Nadu State Board",
    "full_name": "Directorate of Government Examinations, Tamil Nadu",
    "state": "Tamil Nadu",
    "website_url": "https://dge.tn.gov.in",
    "metadata": { "type": "state", "medium": ["english", "tamil"], "approx_students_millions": 9 }
  },
  {
    "code": "MH_MSBSHSE",
    "name": "Maharashtra State Board",
    "full_name": "Maharashtra State Board of Secondary and Higher Secondary Education",
    "state": "Maharashtra",
    "website_url": "https://mahahsscboard.in",
    "metadata": { "type": "state", "medium": ["english", "marathi"], "approx_students_millions": 15 }
  },
  {
    "code": "AP_BSEAP",
    "name": "Andhra Pradesh State Board",
    "full_name": "Board of Secondary Education, Andhra Pradesh",
    "state": "Andhra Pradesh",
    "website_url": "https://bse.ap.gov.in",
    "metadata": { "type": "state", "medium": ["english", "telugu"], "approx_students_millions": 6 }
  },
  {
    "code": "TS_BSETS",
    "name": "Telangana State Board",
    "full_name": "Board of Secondary Education, Telangana",
    "state": "Telangana",
    "website_url": "https://bse.telangana.gov.in",
    "metadata": { "type": "state", "medium": ["english", "telugu", "urdu"], "approx_students_millions": 5 }
  }
]
```

## Phase 3 Boards (Remaining Major State Boards)

```json
[
  { "code": "UP_UPMSP", "name": "UP Board", "state": "Uttar Pradesh", "approx_students_millions": 26 },
  { "code": "BR_BSEB", "name": "Bihar Board", "state": "Bihar", "approx_students_millions": 14 },
  { "code": "RJ_RBSE", "name": "Rajasthan Board", "state": "Rajasthan", "approx_students_millions": 10 },
  { "code": "MP_MPBSE", "name": "MP Board", "state": "Madhya Pradesh", "approx_students_millions": 9 },
  { "code": "WB_WBBSE", "name": "West Bengal Board", "state": "West Bengal", "approx_students_millions": 8 },
  { "code": "GJ_GSEB", "name": "Gujarat Board", "state": "Gujarat", "approx_students_millions": 7 },
  { "code": "HR_BSEH", "name": "Haryana Board", "state": "Haryana" },
  { "code": "PB_PSEB", "name": "Punjab Board", "state": "Punjab" },
  { "code": "JH_JAC", "name": "Jharkhand Board", "state": "Jharkhand" },
  { "code": "CG_CGBSE", "name": "Chhattisgarh Board", "state": "Chhattisgarh" },
  { "code": "OD_BSE", "name": "Odisha Board", "state": "Odisha" },
  { "code": "AS_SEBA", "name": "Assam Board", "state": "Assam" },
  { "code": "HP_HPBOSE", "name": "HP Board", "state": "Himachal Pradesh" },
  { "code": "UK_UBSE", "name": "Uttarakhand Board", "state": "Uttarakhand" },
  { "code": "JK_JKBOSE", "name": "J&K Board", "state": "Jammu & Kashmir" },
  { "code": "GA_GBSHSE", "name": "Goa Board", "state": "Goa" },
  { "code": "MN_BSEM", "name": "Manipur Board", "state": "Manipur" },
  { "code": "ML_MBOSE", "name": "Meghalaya Board", "state": "Meghalaya" },
  { "code": "MZ_MBSE", "name": "Mizoram Board", "state": "Mizoram" },
  { "code": "NL_NBSE", "name": "Nagaland Board", "state": "Nagaland" },
  { "code": "SK_UNKNOWN", "name": "Sikkim Board", "state": "Sikkim" },
  { "code": "TR_TBSE", "name": "Tripura Board", "state": "Tripura" },
  { "code": "AR_DSEAP", "name": "Arunachal Pradesh Board", "state": "Arunachal Pradesh" }
]
```

## Other Boards
```json
[
  { "code": "NIOS", "name": "NIOS", "full_name": "National Institute of Open Schooling", "type": "national_open" },
  { "code": "IB", "name": "IB", "full_name": "International Baccalaureate", "type": "international" },
  { "code": "IGCSE", "name": "IGCSE", "full_name": "Cambridge IGCSE", "type": "international" }
]
```

## Standard Subjects by Grade Range

### Classes 1-5 (Primary)
- English, Hindi/Regional Language, Mathematics, Environmental Studies (EVS), General Knowledge

### Classes 6-8 (Upper Primary)
- English, Hindi/Regional Language (Second Language), Third Language, Mathematics, Science, Social Science, Computer Science (optional)

### Classes 9-10 (Secondary)
- English (Core), Hindi/Regional Language, Mathematics (Standard/Basic for CBSE), Science, Social Science
- Optional: Computer Applications, AI, Information Technology

### Classes 11-12 (Senior Secondary) — Stream-wise
**Science:**
- Physics, Chemistry, Mathematics/Biology, English
- Optional: Computer Science, Physical Education, Economics, Psychology

**Commerce:**
- Accountancy, Business Studies, Economics, English
- Optional: Mathematics, Informatics Practices, Entrepreneurship

**Humanities/Arts:**
- History, Political Science, Geography/Sociology/Psychology, English
- Optional: Economics, Fine Arts, Physical Education, Music
```

## Scraping Source URLs

### CBSE
- Syllabus PDFs: https://cbseacademic.nic.in/curriculum_2026.html
- NCERT Textbooks: https://ncert.nic.in/textbook.php
- Previous papers: https://cbse.gov.in/cbsenew/question-paper.html
- Sample papers: https://cbseacademic.nic.in/SQP_DESGIN_2025-26.html

### ICSE
- Syllabus: https://www.cisce.org/publications.aspx
- Specimen papers: https://www.cisce.org/SpecimenQuestionPaper.aspx

### Kerala
- SCERT syllabus: https://scert.kerala.gov.in
- HSE syllabus: https://www.dhsekerala.gov.in
- SSLC papers: https://keralapareekshabhavan.in

### DIKSHA (All Boards)
- Portal: https://diksha.gov.in
- API/Sunbird: https://github.com/Sunbird-Ed (MIT licensed)
- Content search: https://diksha.gov.in/explore
