import { useEffect, useState, useRef } from 'react';

export function useScanListener(onScan) {
    const [buffer, setBuffer] = useState('');
    const timeoutRef = useRef(null);
    const bufferRef = useRef('');
    const onScanRef = useRef(onScan);
    onScanRef.current = onScan;

    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ignore events initiated from input fields to prevent double submission/interference
            if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

            // Ignore specialized keys but keep alphanumeric
            if (e.key.length > 1 && e.key !== 'Enter') return;

            if (e.key === 'Enter') {
                if (bufferRef.current.length > 0) {
                    // Clean sanitation: remove anything that is not a number
                    const scannedCode = bufferRef.current.replace(/[^0-9]/g, '');
                    if (scannedCode) {
                        onScanRef.current(scannedCode);
                    }
                    bufferRef.current = '';
                    setBuffer('');
                }
                return;
            }

            bufferRef.current += e.key;
            setBuffer(bufferRef.current);

            // Reset buffer if typing is too slow (manual entry vs scanner)
            // Scanners are usually very fast (<50ms between chars)
            // But we just use a simple timeout to clear stale buffers
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => {
                bufferRef.current = '';
                    setBuffer('');
            }, 300); // 300ms idle clears buffer
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    return buffer;
}
