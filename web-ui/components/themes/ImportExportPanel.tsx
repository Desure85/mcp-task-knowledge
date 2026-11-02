'use client';

import { useState } from 'react';
import { Button, Card, CardBody, CardHeader, FileInput, Textarea } from '@/components/ui';
import { exportTheme, type CustomTheme } from '@/lib/custom-theme';

export function ImportExportPanel({
  selected,
  onImport,
}: {
  selected: CustomTheme | null;
  onImport: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const exported = selected ? exportTheme(selected) : '';

  function download() {
    if (!exported) return;
    const blob = new Blob([exported], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selected?.id ?? 'theme'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    if (!exported) return;
    try {
      await navigator.clipboard.writeText(exported);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card>
      <CardHeader className="text-[12px] font-semibold">Import / export JSON</CardHeader>
      <CardBody className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Textarea
            label="Paste a theme"
            rows={6}
            value={text}
            onChange={(event) => setText(event.target.value)}
            hint="JSON из экспорта или файл темы: base + name, цвета в hex, rgb() или hsl()."
          />
          <FileInput
            label="Theme file"
            onFile={(file) => {
              file
                .text()
                .then(setText)
                .catch(() => setText(''));
            }}
          />
          <div className="flex gap-2">
            <Button onClick={() => onImport(text)} disabled={text.trim().length === 0}>
              Import
            </Button>
            <Button variant="ghost" onClick={() => setText('')} disabled={text.length === 0}>
              Clear
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <Textarea
            label="Export selected theme"
            rows={6}
            readOnly
            value={exported}
            placeholder="Select a saved theme to export it."
          />
          <div className="flex gap-2">
            <Button onClick={copy} disabled={!exported}>
              {copied ? 'Copied' : 'Copy JSON'}
            </Button>
            <Button variant="secondary" onClick={download} disabled={!exported}>
              Download
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
