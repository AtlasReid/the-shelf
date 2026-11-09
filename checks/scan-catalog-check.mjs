import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { cards } from '../compatibility/cards.js';

const expected = Array.from({length:14},(_,index) => index+1);
assert.deepEqual(cards.map(card => card.number), expected, 'Keep the supplied card catalogue.');
assert.equal(new Set(cards.map(card => card.id)).size, 14);
const prepared = JSON.parse(await readFile(new URL('../compatibility/assets/scans/manifest.json',import.meta.url),'utf8'));
assert.deepEqual(prepared.cards.map(card => card.id),cards.map(card => card.id),'Preparation metadata uses the runtime card identities.');

function webpSize(bytes) {
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
  let dimensions;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii',offset,offset + 4);
    const length = bytes.readUInt32LE(offset + 4), data = offset + 8;
    assert.ok(data + length <= bytes.length, 'Complete WebP chunk.');
    assert.ok(!['EXIF','XMP '].includes(tag), 'Web derivatives omit scanner/personal metadata.');
    if (tag === 'VP8 ') dimensions = [bytes.readUInt16LE(data + 6) & 16383, bytes.readUInt16LE(data + 8) & 16383];
    if (tag === 'VP8X') dimensions = [bytes.readUIntLE(data + 4,3) + 1, bytes.readUIntLE(data + 7,3) + 1];
    if (tag === 'VP8L') {
      const value = bytes.readUInt32LE(data + 1);
      dimensions = [(value & 16383) + 1, ((value >>> 14) & 16383) + 1];
    }
    offset = data + length + (length % 2);
  }
  assert.ok(dimensions,'WebP contains image data.');
  return dimensions;
}

const paths = new Set();
let bytesTotal = 0, previewPixels = 0, largestFullCardPixels = 0;
for (const card of cards) {
  assert.equal(card.scanNumber, String(card.number).padStart(2,'0'));
  assert.equal(card.id,`card-${card.scanNumber}`);
  assert.ok(card.title.startsWith(`${card.scanNumber} · `));
  const preparation = prepared.cards.find(entry => entry.id === card.id);
  assert.equal(preparation.scanNumber,card.scanNumber);
  assert.equal(preparation.sourceFolder,`Card_${card.scanNumber}`,'Source folders match project numbers directly.');
  const outside = card.scanSources.outside.match(/_(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm_/);
  assert.ok(outside, 'Keep the measured dimensions from the source filename.');
  assert.equal(card.scanSize.width, Number(outside[1]));
  assert.equal(card.scanSize.height, Number(outside[2]));
  assert.equal(card.scanSize.unit,'mm');
  const postcard = card.number === 7, horizontal = card.number === 14;
  assert.equal(card.type, postcard ? 'postcard' : 'folded');
  assert.equal(card.foldAxis, postcard ? 'none' : horizontal ? 'horizontal' : 'vertical');
  assert.equal(card.width, card.scanSize.width / (!postcard && !horizontal ? 2 : 1));
  assert.equal(card.height, card.scanSize.height / (horizontal ? 2 : 1));
  assert.equal(card.finish, card.number === 4 ? 'metallic-outside' : card.number === 3 ? 'gold-foil' : card.number === 14 ? 'gold-metallic-ink' : undefined);
  if (card.finishMaps) assert.deepEqual(preparation.finishMaps,card.finishMaps);
  const surfaces = postcard ? ['back','front'] : ['back','front','insideLeft','insideRight'];
  let fullPixels = 0;
  for (const [tier, images] of [['full',card.surfaces],['preview',card.previewSurfaces]]) {
    assert.deepEqual(Object.keys(images).sort(),surfaces);
    for (const path of Object.values(images)) {
      assert.ok(!paths.has(path), 'Every face/tier has a distinct asset.');
      paths.add(path);
      assert.ok(path.includes(`card-${card.scanNumber}-`));
      assert.ok(path.includes(`_${card.width}x${card.height}mm`), 'Asset filenames retain closed physical size.');
      const bytes = await readFile(new URL(`../compatibility/${path}`,import.meta.url));
      const [width,height] = webpSize(bytes);
      assert.equal(Math.max(width,height), tier === 'preview' ? 512 : 1800);
      assert.ok(Math.abs(width / height - card.width / card.height) <= 1 / Math.min(width,height), 'Each image fits its physical surface without cropping.');
      if (tier === 'preview') previewPixels += width * height;
      else fullPixels += width * height;
      bytesTotal += bytes.length;
    }
  }
  for (const [face,detail] of Object.entries(preparation.surfaces)) {
    assert.equal(detail.full,card.surfaces[face]);
    assert.equal(detail.preview,card.previewSurfaces[face]);
  }
  largestFullCardPixels = Math.max(largestFullCardPixels,fullPixels);
}
assert.equal(paths.size,108, '54 reading surfaces and 54 lightweight previews.');

// Decode the small material PNG with built-in zlib so the standard Node-only
// checks verify its actual pixels, not just a declaration of the masked area.
const foilCard = cards.find(card => card.number === 3);
assert.deepEqual(Object.keys(foilCard.finishMaps),['front']);
assert.ok(cards.filter(card => ![3,14].includes(card.number)).every(card => !card.finishMaps));
async function decodeFinishMap(path) {
  const foilBytes = await readFile(new URL(`../compatibility/${path}`,import.meta.url));
  assert.deepEqual([...foilBytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const foilWidth = foilBytes.readUInt32BE(16), foilHeight = foilBytes.readUInt32BE(20);
  assert.equal(Math.max(foilWidth,foilHeight),1024);
  assert.equal(foilBytes[24],8); assert.equal(foilBytes[25],2,'Material map is RGB8.');
  const chunks = [];
  for (let offset = 8; offset + 12 <= foilBytes.length;) {
    const length = foilBytes.readUInt32BE(offset), tag = foilBytes.toString('ascii',offset+4,offset+8);
    if (tag === 'IDAT') chunks.push(foilBytes.subarray(offset+8,offset+8+length));
    assert.ok(!['eXIf','iTXt','tEXt'].includes(tag),'Material data omits scanner metadata.');
    offset += length + 12;
  }
  const packed = inflateSync(Buffer.concat(chunks)), stride = foilWidth * 3;
  assert.equal(packed.length,(stride+1)*foilHeight);
  const pixels = new Uint8Array(stride*foilHeight);
  const paeth = (a,b,c) => {
    const p=a+b-c, da=Math.abs(p-a), db=Math.abs(p-b), dc=Math.abs(p-c);
    return da<=db && da<=dc ? a : db<=dc ? b : c;
  };
  for (let y=0; y<foilHeight; y++) {
    const filter=packed[y*(stride+1)];
    assert.ok(filter<=4);
    for (let x=0; x<stride; x++) {
      const at=y*stride+x, left=x>=3 ? pixels[at-3] : 0;
      const above=y ? pixels[at-stride] : 0, diagonal=y && x>=3 ? pixels[at-stride-3] : 0;
      const prediction=filter===0 ? 0 : filter===1 ? left : filter===2 ? above : filter===3 ? Math.floor((left+above)/2) : paeth(left,above,diagonal);
      pixels[at]=(packed[y*(stride+1)+1+x]+prediction)&255;
    }
  }
  const pixel = (x,y) => [...pixels.subarray((Math.floor(y*foilHeight)*foilWidth+Math.floor(x*foilWidth))*3,(Math.floor(y*foilHeight)*foilWidth+Math.floor(x*foilWidth))*3+3)];
  return {bytes:foilBytes,width:foilWidth,height:foilHeight,pixels,pixel};
}
const {bytes:foilBytes,width:foilWidth,height:foilHeight,pixels,pixel} = await decodeFinishMap(foilCard.finishMaps.front);
const gold=pixel(.5,.45);
assert.ok(gold[2]>220 && gold[1]<125,'Gold sun is metallic with lower roughness.');
for (const [x,y] of [[.15,.15],[.45,.35],[.5,.6]]) {
  const matte=pixel(x,y);
  assert.equal(matte[2],0,'White paper, navy print and water remain nonmetallic.');
  assert.equal(matte[1],255,'Unfoiled regions keep matte roughness.');
}
let covered=0, soft=0;
for (let index=2; index<pixels.length; index+=3) {
  covered+=pixels[index]/255;
  if (pixels[index]>0 && pixels[index]<255) soft++;
}
assert.ok(covered/(foilWidth*foilHeight)>.005 && covered/(foilWidth*foilHeight)<.03,'Only the small sun is covered.');
assert.ok(soft>30,'The foil edge is antialiased.');
bytesTotal+=foilBytes.length;
const inkCard = cards.find(card => card.number === 14);
assert.deepEqual(Object.keys(inkCard.finishMaps),['insideRight'],'Only the lower handwritten inside gets metallic ink.');
const ink = await decodeFinishMap(inkCard.finishMaps.insideRight);
for (const [x,y] of [[.05,.5],[.2,.1],[.45,.28],[.5,.7],[.7,.8]]) {
  assert.deepEqual(ink.pixel(x,y),[255,255,0],'Paper, black salutation and signature stay matte.');
}
let inkCoverage=0, firstLine=0, secondLine=0;
for (let y=0; y<ink.height; y++) for (let x=0; x<ink.width; x++) {
  const at=(y*ink.width+x)*3, amount=ink.pixels[at+2];
  inkCoverage+=amount/255;
  if (amount>220) {
    assert.ok(x/ink.width>.10 && x/ink.width<.90 && y/ink.height>.30 && y/ink.height<.64,'Metal is confined to the gold greeting.');
    assert.ok(ink.pixels[at+1]>=128 && ink.pixels[at+1]<160,'Ink has a softer, rougher sheen than foil.');
    if(y/ink.height<.50) firstLine++; else secondLine++;
  }
}
assert.ok(firstLine>1000 && secondLine>1000,'Both Merry Christmas and Happy 2024 receive the finish.');
assert.ok(inkCoverage/(ink.width*ink.height)>.02 && inkCoverage/(ink.width*ink.height)<.09,'The gold strokes cover a small part of the sheet.');
bytesTotal+=ink.bytes.length;
assert.ok(bytesTotal < 10 * 1024 * 1024, 'Keep the complete image collection below 10 MiB.');
assert.ok((previewPixels + largestFullCardPixels) * 4 * 4 / 3 < 160 * 1024 * 1024, 'Texture budget: all previews plus one reading card stays below 160 MiB with RGBA mipmaps.');
for (const entry of await readdir(new URL('../compatibility/assets/scans/',import.meta.url),{recursive:true})) {
  if (/\.webp$/i.test(entry)) {
    assert.ok(paths.has(`assets/scans/${entry.replaceAll('\\','/')}`), 'Every scan image belongs to the current catalogue.');
  }
}
console.log(`Scan catalogue checks passed: 14 cards, physical sizes, 108 WebP assets, preview/reading budgets (${(bytesTotal / 1048576).toFixed(1)} MiB).`);
