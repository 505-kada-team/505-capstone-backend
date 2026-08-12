const streamifier = require('streamifier');
const cloudinary = require('../config/cloudinary');

function uploadBufferToCloudinary(buffer, folder = 'kada/menu') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// URL cloudinary bentuknya .../upload/v123456/kada/menu/abcxyz.jpg
// publicId yang perlu buat destroy() adalah "kada/menu/abcxyz"
function extractPublicId(url) {
  if (!url) return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
  return match ? match[1] : null;
}

async function destroyByUrl(url) {
  const publicId = extractPublicId(url);
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    // Non-fatal — jangan sampai gagal hapus gambar lama mem-block
    // flow update/delete menu yang baru.
    console.error('Cloudinary destroy gagal:', err.message);
  }
}

module.exports = { uploadBufferToCloudinary, destroyByUrl };
