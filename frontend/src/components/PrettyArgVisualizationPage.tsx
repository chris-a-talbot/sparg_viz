import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { PrettyArgContainer } from './PrettyArg/PrettyArgContainer';
import { useTreeSequence } from '../context/TreeSequenceContext';
import { useRef } from 'react';

export default function PrettyArgVisualizationPage() {
    const { filename } = useParams<{ filename: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { maxSamples, treeSequence: data } = useTreeSequence();
    const svgRef = useRef<SVGSVGElement>(null);

    // Extract query parameters
    const focusNodeId = searchParams.get('focus') ? parseInt(searchParams.get('focus')!) : undefined;
    const mode = searchParams.get('mode') as 'subgraph' | 'parent' | undefined;

    if (!filename) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-sp-very-dark-blue text-sp-white">
                <h1 className="text-3xl font-bold mb-4">No filename provided</h1>
                <button 
                    className="bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-bold py-2 px-6 rounded-lg mt-4"
                    onClick={() => navigate('/result')}
                >
                    Back to Results
                </button>
            </div>
        );
    }

    const decodedFilename = decodeURIComponent(filename);

    const handleDownload = async () => {
        if (!data) return;
        const downloadUrl = `/download-tree-sequence/${data.filename}`;
        try {
            const response = await fetch(downloadUrl);
            if (!response.ok) {
                throw new Error('Download failed');
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const downloadFilename = data.filename.toLowerCase().endsWith('.trees') ? `${data.filename}.tsz` : data.filename;
            link.setAttribute('download', downloadFilename);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            console.log('Download button clicked for file:', data.filename);
        } catch (error) {
            console.error('Error downloading file:', error);
        }
    };

    const handleDownloadImage = async () => {
        const svgElement = svgRef.current;
        if (!svgElement) return;

        try {
            // Create a clone of the SVG to modify for export
            const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
            
            // Get the current viewBox or use the SVG dimensions
            const viewBox = svgElement.viewBox.baseVal;
            const width = viewBox.width || 800;
            const height = viewBox.height || 600;

            // Set explicit width and height on the clone for publication quality
            svgClone.setAttribute('width', (width * 2).toString()); // 2x resolution
            svgClone.setAttribute('height', (height * 2).toString());
            svgClone.setAttribute('style', 'background-color: white; font-family: Arial, sans-serif;');
            
            // Convert SVG to string
            const svgData = new XMLSerializer().serializeToString(svgClone);
            const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            const svgUrl = URL.createObjectURL(svgBlob);

            // Create an image to load the SVG
            const img = new Image();
            img.onload = () => {
                // Create a high-resolution canvas for publication quality
                const canvas = document.createElement('canvas');
                canvas.width = width * 2;
                canvas.height = height * 2;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                // Fill with white background for publication
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw the SVG
                ctx.drawImage(img, 0, 0);

                // Convert to high-quality PNG and download
                canvas.toBlob((blob) => {
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    const imageFilename = `${decodedFilename.replace(/\.(trees|tsz)$/, '')}_pretty_arg.png`;
                    link.setAttribute('download', imageFilename);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                }, 'image/png', 1.0); // Maximum quality
            };
            img.src = svgUrl;
        } catch (error) {
            console.error('Error downloading image:', error);
        }
    };

    const handleDownloadSVG = async () => {
        const svgElement = svgRef.current;
        if (!svgElement) return;

        try {
            // Create a clone of the SVG for export
            const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
            
            // Set publication-ready styling
            svgClone.setAttribute('style', 'background-color: white; font-family: Arial, sans-serif;');
            
            // Convert SVG to string
            const svgData = new XMLSerializer().serializeToString(svgClone);
            const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);
            
            const link = document.createElement('a');
            link.href = url;
            const svgFilename = `${decodedFilename.replace(/\.(trees|tsz)$/, '')}_pretty_arg.svg`;
            link.setAttribute('download', svgFilename);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error downloading SVG:', error);
        }
    };

    return (
        <div className="min-h-screen bg-sp-very-dark-blue text-sp-white flex flex-col">
            {/* Header */}
            <header className="bg-sp-dark-blue p-4 shadow-md">
                <div className="max-w-7xl mx-auto flex justify-between items-center">
                    <button 
                        className="text-sp-pale-green hover:text-sp-white text-lg font-medium px-2 py-1 rounded transition-colors"
                        onClick={() => navigate('/result')}
                    >
                        {'< Back to Results'}
                    </button>
                    <div className="flex items-center gap-4">
                        <h1 className="text-2xl font-bold">
                            sp<span className="text-sp-pale-green">ARG</span>viz - Pretty ARG
                        </h1>
                        <div className="text-sm font-mono text-sp-pale-green bg-sp-very-dark-blue px-2 py-1 rounded">
                            Publication Ready
                        </div>
                        <div className="text-lg font-mono text-sp-pale-green">
                            {decodedFilename}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            className="bg-sp-very-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-4 py-2 rounded-lg text-base transition-colors"
                            onClick={handleDownloadSVG}
                        >
                            Download SVG
                        </button>
                        <button 
                            className="bg-sp-very-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-4 py-2 rounded-lg text-base transition-colors"
                            onClick={handleDownloadImage}
                        >
                            Download PNG
                        </button>
                        <button 
                            className="bg-sp-very-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-4 py-2 rounded-lg text-base transition-colors"
                            onClick={handleDownload}
                        >
                            Download .tsz
                        </button>
                    </div>
                </div>
            </header>

            {/* Main content */}
            <main className="flex-1 p-4">
                <div className="max-w-7xl mx-auto h-[calc(100vh-3rem)]">
                    <PrettyArgContainer 
                        ref={svgRef}
                        filename={decodedFilename}
                        max_samples={maxSamples}
                        focusNodeId={focusNodeId}
                        mode={mode}
                    />
                </div>
            </main>
        </div>
    );
} 