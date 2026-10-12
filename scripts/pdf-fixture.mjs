// A valid PDF built byte by byte (objects, xref, trailer), so pdf.js really parses
// and draws it. Shared by the reader test and the ink audit.
export function buildPdf(pages) {
  const objs = []                                   // 1-based object bodies
  const add = body => objs.push(body) && objs.length
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const kids = []
  const pageIds = []
  for (const lines of pages) {
    const stream = 'BT /F1 22 Tf 72 700 Td 28 TL ' + lines.map(l => `(${l.replace(/[()\\]/g, '\\$&')}) Tj T*`).join(' ') + ' ET'
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    pageIds.push(add(''))                           // patched once the Pages id is known
    kids.push({ content })
  }
  const pagesId = add('')
  pageIds.forEach((id, i) => { objs[id - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${kids[i].content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>` })
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  let out = '%PDF-1.4\n'; const offsets = []
  objs.forEach((b, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${b}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

export const PDF = buildPdf([
  ['Alpha chapter opens here', 'with a second line of words'],
  ['Beta page two begins', 'and carries on a little'],
  ['Gamma closes the book'],
])
