import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { imagesService } from '../services/images.service';
import { useRefetchOnVisible } from '../hooks/useRefetchOnVisible';

const Images = () => {
  const { serverId } = useParams();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pullImageName, setPullImageName] = useState('');
  const [pulling, setPulling] = useState(false);

  const fetchImages = async () => {
    try {
      const response = await imagesService.getAll(serverId);
      setImages(response.data.images);
    } catch (error) {
      console.error('Failed to fetch images:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, [serverId]);

  useRefetchOnVisible(fetchImages);

  const handlePullImage = async (e) => {
    e.preventDefault();
    if (!pullImageName.trim()) return;

    setPulling(true);
    try {
      const response = await imagesService.pull(serverId, pullImageName);
      if (response.data.success) {
        setPullImageName('');
        fetchImages();
        alert('Image pulled successfully');
      } else {
        alert(response.data.message || 'Failed to pull image');
      }
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to pull image');
    } finally {
      setPulling(false);
    }
  };

  const handleRemoveImage = async (imageId) => {
    if (!window.confirm('Are you sure you want to remove this image?')) {
      return;
    }

    try {
      const response = await imagesService.remove(serverId, imageId);
      if (response.data.success) {
        fetchImages();
        alert('Image removed successfully');
      } else {
        alert(response.data.message || 'Failed to remove image');
      }
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to remove image');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6">
        <Link
          to={`/servers/${serverId}`}
          className="text-sm text-primary-600 hover:text-primary-700 mb-2 inline-block"
        >
          ← Back to server
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Docker Images</h1>
      </div>

      <div className="mb-6 bg-white p-4 rounded-lg shadow">
        <form onSubmit={handlePullImage} className="flex gap-2">
          <input
            type="text"
            value={pullImageName}
            onChange={(e) => setPullImageName(e.target.value)}
            placeholder="e.g., nginx:latest"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            type="submit"
            disabled={pulling || !pullImageName.trim()}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            {pulling ? 'Pulling...' : 'Pull Image'}
          </button>
        </form>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {images.length === 0 ? (
            <li className="px-6 py-4 text-center text-gray-500">No images found</li>
          ) : (
            images.map((image, index) => {
              const imageId = image.ID || image.ImageID || image['.ID'] || index;
              const repository = image.Repository || image['.Repository'] || '<none>';
              const tag = image.Tag || image['.Tag'] || '<none>';
              const size = image.Size || image['.Size'] || 'Unknown';

              return (
                <li key={imageId} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {repository}:{tag}
                      </p>
                      <p className="text-sm text-gray-500">Size: {size}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        ID: {typeof imageId === 'string' ? imageId.substring(0, 12) : imageId}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveImage(imageId)}
                      className="px-3 py-1 text-sm bg-red-100 text-red-800 rounded hover:bg-red-200"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
};

export default Images;
