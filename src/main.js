import { SupernoteX } from 'supernote-typescript'
import MyWorker from './worker?worker'
import { SupernoteViewer } from '../lib/SupernoteViewer.js'

class SupernoteWorker {
  constructor() {
    this.worker = new MyWorker()
  }

  process(note, pageIndex) {
    this.worker.postMessage({ note, pageIndex })
  }

  onMessage(callback) {
    this.worker.onmessage = (e) => callback(e.data)
  }

  terminate() {
    this.worker.terminate()
  }
}

const hardwareConcurrency = navigator.hardwareConcurrency || 3
const MAX_WORKERS = Math.min(hardwareConcurrency, 8)

function updateStatus(message) {
  console.log(message)
}

// Application state
let workers = []
let viewer = null

function cleanupWorkers() {
  workers.forEach(worker => worker.terminate())
  workers = []
}

function handleUploadClick() {
  if (viewer) {
    cleanupWorkers()
    viewer.reset()
  }
  document.getElementById('noteInput').click()
}

// Process note buffer from either file upload or URL fetch
async function processNoteBuffer(arrayBuffer) {
  const note = new SupernoteX(new Uint8Array(arrayBuffer))
  const totalPages = note.pages.length

  // Initialize the viewer with the total number of pages
  viewer.initializePages(totalPages)

  // Hide GitHub fork ribbon when viewing
  const forkRibbon = document.querySelector('.github-fork-ribbon')
  if (forkRibbon) {
    forkRibbon.style.display = 'none'
  }

  // Clean up any existing workers
  cleanupWorkers()

  // Create workers and process pages
  workers = Array(MAX_WORKERS).fill(null).map(() => new SupernoteWorker())
  const processQueue = Array.from({ length: totalPages }, (_, i) => i + 1)

  workers.forEach(worker => {
    worker.onMessage(async ({ pageIndex, imageData, status, error }) => {
      if (status === 'success') {
        const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageData)))
        
        // Get image dimensions
        const img = new Image()
        img.src = `data:image/png;base64,${base64Image}`
        img.onload = () => {
          viewer.addPageImage(pageIndex, base64Image, img.width, img.height)
        }
        img.onerror = (err) => {
          console.error(`Error loading image for dimensions for page ${pageIndex}:`, err)
          viewer.addPageImage(pageIndex, base64Image, 800, 600)
        }
      } else {
        console.error(`Error processing page ${pageIndex}:`, error)
      }

      const nextPage = processQueue.shift()
      if (nextPage) {
        worker.process(note, nextPage)
      }
    })
  })

  workers.forEach(worker => {
    const pageIndex = processQueue.shift()
    if (pageIndex) worker.process(note, pageIndex)
  })
}

document.addEventListener('DOMContentLoaded', async () => {
  // Check for ?file= URL parameter
  const params = new URLSearchParams(window.location.search)
  const fileUrl = params.get('file')

  // Initialize the SupernoteViewer with callbacks
  viewer = new SupernoteViewer({
    onProgress: (completed, total) => {
      updateStatus(`Processed ${completed}/${total} pages`)
    },
    onPageComplete: (pageNumber, src, width, height) => {
      // Page completed callback - could be used for additional processing
    },
    onUploadClick: handleUploadClick,
    showUploadCard: !fileUrl
  })

  // Set up upload click handler
  window.handleUploadClick = handleUploadClick

  // Load file from URL if specified
  if (fileUrl) {
    updateStatus('Fetching file from URL...')
    try {
      const response = await fetch(fileUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const arrayBuffer = await response.arrayBuffer()
      await processNoteBuffer(arrayBuffer)
    } catch (err) {
      console.error('Failed to load file from URL:', err)
      updateStatus('Failed to load file from URL')
    }
  }

  document.getElementById('noteInput').addEventListener('change', async (event) => {
    const file = event.target.files[0]
    if (!file) return

    updateStatus('Loading file...')
    const arrayBuffer = await file.arrayBuffer()
    await processNoteBuffer(arrayBuffer)
  })
})
