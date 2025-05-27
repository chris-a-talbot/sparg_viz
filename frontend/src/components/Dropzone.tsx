import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { api } from '../lib/api';
import { log } from '../lib/logger';
import { FILE_TYPES } from '../config/constants';

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
    accept: FILE_TYPES.ACCEPTED_FORMATS,
  });

  const handleRun = async () => {
    if (file) {
      setLoading(true);
      
      try {
        log.user.action('upload-start', { filename: file.name, size: file.size }, 'Dropzone');
        const result = await api.uploadTreeSequence(file);
        
        log.info('File upload completed successfully', {
          component: 'Dropzone',
          data: { filename: file.name, result }
        });
        
        if (onUploadComplete) {
          onUploadComplete(result.data);
        }
      } catch (err) {
        log.error('File upload failed', {
          component: 'Dropzone',
          error: err instanceof Error ? err : new Error(String(err)),
          data: { filename: file.name }
        });
        // Show error message to user
        alert(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
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