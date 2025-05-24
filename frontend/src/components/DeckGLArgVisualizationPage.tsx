import { useParams, useNavigate } from 'react-router-dom';
import { DeckGLArgVisualizationContainer } from './DeckGLArgVisualization/DeckGLArgVisualizationContainer';
import { useTreeSequence } from '../context/TreeSequenceContext';
import { useRef } from 'react';

export default function DeckGLArgVisualizationPage() {
    const { filename } = useParams<{ filename: string }>();
    const navigate = useNavigate();
    const { maxSamples, treeSequence: data } = useTreeSequence();
    const canvasRef = useRef<HTMLCanvasElement>(null);

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
        const canvas = canvasRef.current;
        if (!canvas) return;

        try {
            // Convert canvas to PNG and download
            canvas.toBlob((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                const imageFilename = `${decodedFilename.replace(/\.(trees|tsz)$/, '')}_arg_large.png`;
                link.setAttribute('download', imageFilename);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }, 'image/png');
        } catch (error) {
            console.error('Error downloading image:', error);
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
                            sp<span className="text-sp-pale-green">ARG</span>viz - Large ARG Visualization
                        </h1>
                        <div className="text-lg font-mono text-sp-pale-green">
                            {decodedFilename}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            className="bg-sp-very-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-4 py-2 rounded-lg text-base transition-colors"
                            onClick={handleDownloadImage}
                        >
                            Download Image
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
                    <DeckGLArgVisualizationContainer 
                        ref={canvasRef}
                        filename={decodedFilename}
                        max_samples={maxSamples}
                    />
                </div>
            </main>
        </div>
    );
} 