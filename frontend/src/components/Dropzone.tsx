import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { apiConfig } from '../config/api';

type DropzoneProps = {
  onUploadComplete?: (result: any) => void;
  setLoading: (isLoading: boolean) => void;
};

export default function Dropzone({ onUploadComplete, setLoading }: DropzoneProps) {  
  const [file, setFile] = useState<File | null>(null);
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
    }
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      'application/octet-stream': ['.trees', '.tsz'],
      'application/x-trees': ['.trees'],
      'application/x-tsz': ['.tsz'],
    },
  });

  const handleRun = async () => {
    if (file) {
      setLoading(true);
      const formData = new FormData();
      formData.append('file', file);
  
      try {
        const response = await fetch(`${apiConfig.baseURL}/upload-tree-sequence`, {
          method: 'POST',
          body: formData,
        });
        if (!response.ok) {
          throw new Error('Upload failed');
        }
        const result = await response.json();
        console.log('Backend response:', result);
        if (onUploadComplete) {
          onUploadComplete(result);
        }
        // Optionally show a success message to the user here
      } catch (err) {
        console.error('Error uploading file:', err);
        // Optionally show an error message to the user here
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="w-full flex flex-col items-center gap-4">
      <div
        {...getRootProps()}
        className={`w-full h-48 border-2 border-dashed rounded-xl flex items-center justify-center text-xl transition-colors cursor-pointer select-none
          ${isDragActive ? 'border-sp-pale-green bg-sp-dark-blue text-sp-white' : 'border-sp-dark-blue bg-sp-very-dark-blue text-sp-very-pale-green'}`}
        tabIndex={0}
      >
        <input {...getInputProps()} />
        {file ? (
          <span className="truncate max-w-full px-2">{file.name}</span>
        ) : isDragActive ? (
          <span>Drop the file here…</span>
        ) : (
          <span>Drag and drop to select a file<br /><span className="text-base text-sp-pale-green">or click to browse</span></span>
        )}
      </div>
      {file && (
        <button
          type="button"
          onClick={handleRun}
          className="w-full mt-2 bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-bold py-2 rounded-lg transition-colors shadow-md text-lg"
        >
          Run
        </button>
      )}
    </div>
  );
} 