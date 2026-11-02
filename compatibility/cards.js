// Browser-sized surfaces derived from the user's paired flat scans.
// width/height are the closed card's physical millimetres, not the flat spread.
// Card 07 is a postcard; card 14 has a horizontal fold.
// Rebuild with scripts/prepare-card-scans.py; original scans stay outside this repository.
export const cards = [
  {
    "id": "card-01",
    "number": 1,
    "scanNumber": "01",
    "title": "01 · Congratulations",
    "occasion": "Congratulations",
    "type": "folded",
    "foldAxis": "vertical",
    "width": 132.55,
    "height": 187.1,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 265.1,
      "height": 187.1,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-01_265.1x187.1mm_6263x4420px.jpg",
      "inside": "2_Inside_from-02_265.1x187.1mm_6262x4420px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-01-front_132.55x187.1mm.webp",
      "back": "assets/scans/card-01-back_132.55x187.1mm.webp",
      "insideLeft": "assets/scans/card-01-inside-left_132.55x187.1mm.webp",
      "insideRight": "assets/scans/card-01-inside-right_132.55x187.1mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-01-front_132.55x187.1mm.webp",
      "back": "assets/scans/previews/card-01-back_132.55x187.1mm.webp",
      "insideLeft": "assets/scans/previews/card-01-inside-left_132.55x187.1mm.webp",
      "insideRight": "assets/scans/previews/card-01-inside-right_132.55x187.1mm.webp"
    }
  },
  {
    "id": "card-02",
    "number": 2,
    "scanNumber": "02",
    "title": "02 · Meeting zone",
    "occasion": "A good wish",
    "type": "folded",
    "foldAxis": "vertical",
    "width": 158.55,
    "height": 159.8,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 317.1,
      "height": 159.8,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-03_317.1x159.8mm_7490x3774px.jpg",
      "inside": "2_Inside_from-04_317.2x159.6mm_7492x3771px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-02-front_158.55x159.8mm.webp",
      "back": "assets/scans/card-02-back_158.55x159.8mm.webp",
      "insideLeft": "assets/scans/card-02-inside-left_158.55x159.8mm.webp",
      "insideRight": "assets/scans/card-02-inside-right_158.55x159.8mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-02-front_158.55x159.8mm.webp",
      "back": "assets/scans/previews/card-02-back_158.55x159.8mm.webp",
      "insideLeft": "assets/scans/previews/card-02-inside-left_158.55x159.8mm.webp",
      "insideRight": "assets/scans/previews/card-02-inside-right_158.55x159.8mm.webp"
    }
  },
  {
    "id": "card-03",
    "number": 3,
    "scanNumber": "03",
    "title": "03 · Christmas moon",
    "occasion": "Christmas",
    "type": "folded",
    "foldAxis": "vertical",
    "width": 124.8,
    "height": 135.0,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 249.6,
      "height": 135.0,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-05_249.6x135.0mm_5896x3189px.jpg",
      "inside": "2_Inside_from-06_249.7x135.0mm_5899x3190px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-03-front_124.8x135mm.webp",
      "back": "assets/scans/card-03-back_124.8x135mm.webp",
      "insideLeft": "assets/scans/card-03-inside-left_124.8x135mm.webp",
      "insideRight": "assets/scans/card-03-inside-right_124.8x135mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-03-front_124.8x135mm.webp",
      "back": "assets/scans/previews/card-03-back_124.8x135mm.webp",
      "insideLeft": "assets/scans/previews/card-03-inside-left_124.8x135mm.webp",
      "insideRight": "assets/scans/previews/card-03-inside-right_124.8x135mm.webp"
    },
    "finish": "gold-foil",
    "finishMaps": {
      "front": "assets/scans/card-03-front-foil_124.8x135mm.png"
    }
  },
  {
    "id": "card-04",
    "number": 4,
    "scanNumber": "04",
    "title": "04 · Happy 30th birthday",
    "occasion": "Birthday",
    "type": "folded",
    "foldAxis": "vertical",
    "width": 104.3,
    "height": 150.2,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 208.6,
      "height": 150.2,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-07_208.6x150.2mm_4927x3547px.jpg",
      "inside": "2_Inside_from-09_208.6x150.2mm_4928x3548px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-04-front_104.3x150.2mm.webp",
      "back": "assets/scans/card-04-back_104.3x150.2mm.webp",
      "insideLeft": "assets/scans/card-04-inside-left_104.3x150.2mm.webp",
      "insideRight": "assets/scans/card-04-inside-right_104.3x150.2mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-04-front_104.3x150.2mm.webp",
      "back": "assets/scans/previews/card-04-back_104.3x150.2mm.webp",
      "insideLeft": "assets/scans/previews/card-04-inside-left_104.3x150.2mm.webp",
      "insideRight": "assets/scans/previews/card-04-inside-right_104.3x150.2mm.webp"
    },
    "finish": "metallic-outside"
  },
  {
    "id": "card-05",
    "number": 5,
    "scanNumber": "05",
    "title": "05 · You are amazing",
    "occasion": "Just because",
    "type": "folded",
    "foldAxis": "vertical",
    "width": 104.1,
    "height": 150.3,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 208.2,
      "height": 150.3,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-08_208.2x150.3mm_4917x3550px.jpg",
      "inside": "2_Inside_from-10_208.2x150.3mm_4919x3551px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-05-front_104.1x150.3mm.webp",
      "back": "assets/scans/card-05-back_104.1x150.3mm.webp",
      "insideLeft": "assets/scans/card-05-inside-left_104.1x150.3mm.webp",
      "insideRight": "assets/scans/card-05-inside-right_104.1x150.3mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-05-front_104.1x150.3mm.webp",
      "back": "assets/scans/previews/card-05-back_104.1x150.3mm.webp",
      "insideLeft": "assets/scans/previews/card-05-inside-left_104.1x150.3mm.webp",
      "insideRight": "assets/scans/previews/card-05-inside-right_104.1x150.3mm.webp"
    }
  },
  {
    "id": "card-06",
    "number": 6,
    "scanNumber": "06",
    "title": "06 · Happy holidays",
    "occasion": "Christmas",
    "type": "folded",
    "foldAxis": "vertical",
    "width": 119.7,
    "height": 169.8,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 239.4,
      "height": 169.8,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-12_239.4x169.8mm_5656x4012px.jpg",
      "inside": "2_Inside_from-11_239.5x169.9mm_5658x4013px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-06-front_119.7x169.8mm.webp",
      "back": "assets/scans/card-06-back_119.7x169.8mm.webp",
      "insideLeft": "assets/scans/card-06-inside-left_119.7x169.8mm.webp",
      "insideRight": "assets/scans/card-06-inside-right_119.7x169.8mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-06-front_119.7x169.8mm.webp",
      "back": "assets/scans/previews/card-06-back_119.7x169.8mm.webp",
      "insideLeft": "assets/scans/previews/card-06-inside-left_119.7x169.8mm.webp",
      "insideRight": "assets/scans/previews/card-06-inside-right_119.7x169.8mm.webp"
    }
  },
  {
    "id": "card-07",
    "number": 7,
    "scanNumber": "07",
    "title": "07 · Newcastle postcard",
    "occasion": "Postcard",
    "type": "postcard",
    "foldAxis": "none",
    "width": 148.3,
    "height": 104.8,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 148.3,
      "height": 104.8,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-14_148.3x104.8mm_3504x2476px.jpg",
      "inside": "2_Inside_from-13_148.4x104.9mm_3505x2477px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-07-front_148.3x104.8mm.webp",
      "back": "assets/scans/card-07-back_148.3x104.8mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-07-front_148.3x104.8mm.webp",
      "back": "assets/scans/previews/card-07-back_148.3x104.8mm.webp"
    }
  },
  {
    "id": "card-08",
    "number": 8,
    "scanNumber": "08",
    "title": "08 · Festive wishes",
    "occasion": "Christmas",
    "type": "folded",
    "foldAxis": "vertical",
    "width": 134.5,
    "height": 134.9,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 269.0,
      "height": 134.9,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-15_269.0x134.9mm_6354x3186px.jpg",
      "inside": "2_Inside_from-17_269.0x134.8mm_6354x3185px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-08-front_134.5x134.9mm.webp",
      "back": "assets/scans/card-08-back_134.5x134.9mm.webp",
      "insideLeft": "assets/scans/card-08-inside-left_134.5x134.9mm.webp",
      "insideRight": "assets/scans/card-08-inside-right_134.5x134.9mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-08-front_134.5x134.9mm.webp",
      "back": "assets/scans/previews/card-08-back_134.5x134.9mm.webp",
      "insideLeft": "assets/scans/previews/card-08-inside-left_134.5x134.9mm.webp",
      "insideRight": "assets/scans/previews/card-08-inside-right_134.5x134.9mm.webp"
    }
  },
  {
    "id": "card-09",
    "number": 9,
    "scanNumber": "09",
    "title": "09 · Winter wishes",
    "occasion": "Christmas",
    "type": "folded",
    "foldAxis": "vertical",
    "width": 134.65,
    "height": 134.8,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 269.3,
      "height": 134.8,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-16_269.3x134.8mm_6361x3184px.jpg",
      "inside": "2_Inside_from-18_269.4x134.8mm_6363x3185px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-09-front_134.65x134.8mm.webp",
      "back": "assets/scans/card-09-back_134.65x134.8mm.webp",
      "insideLeft": "assets/scans/card-09-inside-left_134.65x134.8mm.webp",
      "insideRight": "assets/scans/card-09-inside-right_134.65x134.8mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-09-front_134.65x134.8mm.webp",
      "back": "assets/scans/previews/card-09-back_134.65x134.8mm.webp",
      "insideLeft": "assets/scans/previews/card-09-inside-left_134.65x134.8mm.webp",
      "insideRight": "assets/scans/previews/card-09-inside-right_134.65x134.8mm.webp"
    }
  },
  {
    "id": "card-10",
    "number": 10,
    "scanNumber": "10",
    "title": "10 · Jingle all the way",
    "occasion": "Christmas",
    "type": "folded",
    "foldAxis": "vertical",
    "width": 134.65,
    "height": 134.9,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 269.3,
      "height": 134.9,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-24_269.3x134.9mm_6361x3186px.jpg",
      "inside": "2_Inside_from-23_269.4x135.0mm_6364x3188px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-10-front_134.65x134.9mm.webp",
      "back": "assets/scans/card-10-back_134.65x134.9mm.webp",
      "insideLeft": "assets/scans/card-10-inside-left_134.65x134.9mm.webp",
      "insideRight": "assets/scans/card-10-inside-right_134.65x134.9mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-10-front_134.65x134.9mm.webp",
      "back": "assets/scans/previews/card-10-back_134.65x134.9mm.webp",
      "insideLeft": "assets/scans/previews/card-10-inside-left_134.65x134.9mm.webp",
      "insideRight": "assets/scans/previews/card-10-inside-right_134.65x134.9mm.webp"
    }
  },
  {
    "id": "card-11",
    "number": 11,
    "scanNumber": "11",
    "title": "11 · Season’s greetings",
    "occasion": "Christmas",
    "type": "folded",
    "foldAxis": "vertical",
    "width": 124.65,
    "height": 164.6,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 249.3,
      "height": 164.6,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-21_249.3x164.6mm_5889x3888px.jpg",
      "inside": "2_Inside_from-22_249.0x164.6mm_5883x3889px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-11-front_124.65x164.6mm.webp",
      "back": "assets/scans/card-11-back_124.65x164.6mm.webp",
      "insideLeft": "assets/scans/card-11-inside-left_124.65x164.6mm.webp",
      "insideRight": "assets/scans/card-11-inside-right_124.65x164.6mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-11-front_124.65x164.6mm.webp",
      "back": "assets/scans/previews/card-11-back_124.65x164.6mm.webp",
      "insideLeft": "assets/scans/previews/card-11-inside-left_124.65x164.6mm.webp",
      "insideRight": "assets/scans/previews/card-11-inside-right_124.65x164.6mm.webp"
    }
  },
  {
    "id": "card-12",
    "number": 12,
    "scanNumber": "12",
    "title": "12 · Christmas tree",
    "occasion": "Christmas",
    "type": "folded",
    "foldAxis": "vertical",
    "width": 159.8,
    "height": 160.2,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 319.6,
      "height": 160.2,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-19_319.6x160.2mm_7550x3785px.jpg",
      "inside": "2_Inside_from-20_319.6x160.3mm_7550x3787px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-12-front_159.8x160.2mm.webp",
      "back": "assets/scans/card-12-back_159.8x160.2mm.webp",
      "insideLeft": "assets/scans/card-12-inside-left_159.8x160.2mm.webp",
      "insideRight": "assets/scans/card-12-inside-right_159.8x160.2mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-12-front_159.8x160.2mm.webp",
      "back": "assets/scans/previews/card-12-back_159.8x160.2mm.webp",
      "insideLeft": "assets/scans/previews/card-12-inside-left_159.8x160.2mm.webp",
      "insideRight": "assets/scans/previews/card-12-inside-right_159.8x160.2mm.webp"
    }
  },
  {
    "id": "card-13",
    "number": 13,
    "scanNumber": "13",
    "title": "13 · Penguin pair",
    "occasion": "Christmas",
    "type": "folded",
    "foldAxis": "vertical",
    "width": 148.35,
    "height": 210.8,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 296.7,
      "height": 210.8,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-27_296.7x210.8mm_7009x4979px.jpg",
      "inside": "2_Inside_from-28_296.9x210.8mm_7013x4979px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-13-front_148.35x210.8mm.webp",
      "back": "assets/scans/card-13-back_148.35x210.8mm.webp",
      "insideLeft": "assets/scans/card-13-inside-left_148.35x210.8mm.webp",
      "insideRight": "assets/scans/card-13-inside-right_148.35x210.8mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-13-front_148.35x210.8mm.webp",
      "back": "assets/scans/previews/card-13-back_148.35x210.8mm.webp",
      "insideLeft": "assets/scans/previews/card-13-inside-left_148.35x210.8mm.webp",
      "insideRight": "assets/scans/previews/card-13-inside-right_148.35x210.8mm.webp"
    }
  },
  {
    "id": "card-14",
    "number": 14,
    "scanNumber": "14",
    "title": "14 · Polar bears",
    "occasion": "Christmas",
    "type": "folded",
    "foldAxis": "horizontal",
    "width": 210.6,
    "height": 148.4,
    "paper": "#fffdf6",
    "scanSize": {
      "width": 210.6,
      "height": 296.8,
      "unit": "mm"
    },
    "scanSources": {
      "outside": "1_Outside_from-29_210.6x296.8mm_4974x7011px.jpg",
      "inside": "2_Inside_from-30_210.6x296.8mm_4975x7010px.jpg"
    },
    "surfaces": {
      "front": "assets/scans/card-14-front_210.6x148.4mm.webp",
      "back": "assets/scans/card-14-back_210.6x148.4mm.webp",
      "insideLeft": "assets/scans/card-14-inside-left_210.6x148.4mm.webp",
      "insideRight": "assets/scans/card-14-inside-right_210.6x148.4mm.webp"
    },
    "previewSurfaces": {
      "front": "assets/scans/previews/card-14-front_210.6x148.4mm.webp",
      "back": "assets/scans/previews/card-14-back_210.6x148.4mm.webp",
      "insideLeft": "assets/scans/previews/card-14-inside-left_210.6x148.4mm.webp",
      "insideRight": "assets/scans/previews/card-14-inside-right_210.6x148.4mm.webp"
    }
  }
];
