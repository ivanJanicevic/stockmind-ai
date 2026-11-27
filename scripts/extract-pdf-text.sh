#!/bin/sh
# Re-creates data/text/*.txt from the text layer of the invoice and delivery-note
# PDFs. The app reads these .txt files so it needs no PDF library; the PDFs stay
# the source of record. macOS only (uses PDFKit through JavaScript for Automation).
set -eu
cd "$(dirname "$0")/.."
mkdir -p data/text
for pdf in data/fakture/*.pdf data/otpremnice/*.pdf; do
  out="data/text/$(basename "$pdf" .pdf).txt"
  osascript -l JavaScript -e "ObjC.import('PDFKit'); function run(a) { var d = \$.PDFDocument.alloc.initWithURL(\$.NSURL.fileURLWithPath(a[0])); return d.string.js; }" "$PWD/$pdf" > "$out"
  echo "$out"
done
