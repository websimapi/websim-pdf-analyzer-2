import * as pdfjsLib from "pdfjs-dist/build/pdf.min.mjs";

// Specify the workerSrc explicitly
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.677/pdf.worker.min.mjs";

const pdfInput = document.getElementById('pdfInput');
const loadingText = document.getElementById('loading-text');
const statusSection = document.getElementById('status-section');
const resultsDiv = document.getElementById('results');
const fileNameDisplay = document.getElementById('file-name-display');
const errorMessageDiv = document.getElementById('error-message');
const loadingContainer = statusSection.querySelector('.loading-container');
const mainSpinner = statusSection.querySelector('.spinner');

let totalPages = 0;
let completedAnalyses = 0;

pdfInput.addEventListener('change', handleFileSelect);

function showStatus(message, showSpinner = true) {
    loadingText.textContent = message;
    if(mainSpinner) mainSpinner.style.display = showSpinner ? 'block' : 'none';
    if(loadingContainer) loadingContainer.style.display = 'flex'; // Ensure container is visible
    statusSection.style.display = 'block';
    errorMessageDiv.style.display = 'none'; // Hide previous errors
}

function hideStatus() {
    statusSection.style.display = 'none';
    if(loadingContainer) loadingContainer.style.display = 'none';
}

function showError(message) {
    errorMessageDiv.textContent = message;
    errorMessageDiv.style.display = 'block';
    statusSection.style.display = 'block'; // Keep status section visible to show error
    loadingText.textContent = 'Error Occurred'; // Update loading text to reflect error
     // Hide the spinner within the loading container
    if(mainSpinner) mainSpinner.style.display = 'none';
    if(loadingContainer) loadingContainer.style.display = 'flex'; // Keep container for error message link
}

function hideError() {
    errorMessageDiv.style.display = 'none';
}

async function handleFileSelect(event) {
    const file = event.target.files[0];
    // Reset counters
    totalPages = 0;
    completedAnalyses = 0;

    if (!file) {
        fileNameDisplay.textContent = 'No file selected';
        resultsDiv.innerHTML = ''; // Clear results
        hideStatus();
        hideError();
        return;
    }

    if (file.type !== 'application/pdf') {
        showError('Error: Please select a valid PDF file.');
        fileNameDisplay.textContent = 'Invalid file type';
        pdfInput.value = ''; // Reset file input
        resultsDiv.innerHTML = ''; // Clear results
        return;
    }

    fileNameDisplay.textContent = `Selected: ${file.name}`;
    showStatus('Preparing to process PDF...', true);
    resultsDiv.innerHTML = ''; // Clear previous results
    hideError(); // Clear any previous errors

    try {
        const fileReader = new FileReader();
        fileReader.onload = async function() {
            const typedarray = new Uint8Array(this.result);
            await processPdf(typedarray);
            // Status update handled within processPdf and analyzePageImage
        };
        fileReader.onerror = () => {
             showError('Error reading the file.');
             // Don't hide status section as error is shown there
             pdfInput.value = ''; // Reset file input
             fileNameDisplay.textContent = 'Error reading file';
        };
        fileReader.readAsArrayBuffer(file);
    } catch (error) {
        console.error('Error setting up file reader:', error);
        showError('An unexpected error occurred while trying to read the file.');
        // Don't hide status section
        pdfInput.value = ''; // Reset file input
        fileNameDisplay.textContent = 'Error reading file';
    }
}

async function processPdf(pdfData) {
    let pdf;
    try {
        showStatus('Loading PDF document...', true);
        pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    } catch (error) {
        console.error('Error loading PDF document:', error);
        showError(`Error loading PDF: ${error.message || 'Unknown error'}`);
        // Status section remains visible due to error
        return;
    }

    totalPages = pdf.numPages;
    completedAnalyses = 0; // Reset analysis counter for this PDF
    showStatus(`Found ${totalPages} pages. Rendering pages...`, true);

    const analysisPromises = [];

    for (let i = 1; i <= totalPages; i++) {
        // Update status more granularly if needed, e.g., showStatus(`Rendering page ${i} of ${totalPages}...`)
        // For simplicity, keep the overall status as "Rendering..." or "Processing..."
        if (i % 5 === 0 || i === 1) { // Update status periodically
             showStatus(`Processing page ${i} of ${totalPages}...`, true);
        }

        try {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 }); // Scale for better image quality

            // Use an offscreen canvas if available and desired for performance,
            // but a regular canvas works fine here.
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d', { willReadFrequently: true }); // Hint for performance if needed
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };
            await page.render(renderContext).promise;

            // Getting Data URL can be slow for many large pages.
            // Consider optimizations if performance is critical (e.g., batching, workers)
            const imageDataUrl = canvas.toDataURL('image/png');

            // Display the page container immediately
            const pageContainer = document.createElement('div');
            pageContainer.className = 'page-container';
            pageContainer.id = `page-${i}-container`; // Add ID for potential later use
            pageContainer.innerHTML = `
                <h2>Page ${i}</h2>
                <div class="page-content">
                    <div class="image-wrapper">
                         <img src="${imageDataUrl}" alt="Page ${i} Image Loading...">
                    </div>
                    <div class="analysis-section">
                        <h3>AI Analysis:</h3>
                        <div class="analysis analyzing" id="analysis-${i}">
                            <span class="analysis-spinner"></span>Analyzing...
                        </div>
                    </div>
                </div>
            `;
            resultsDiv.appendChild(pageContainer);
             // Add alt text update after image load
            const imgElement = pageContainer.querySelector('img');
            imgElement.onload = () => imgElement.alt = `Page ${i} Image`;
            imgElement.onerror = () => imgElement.alt = `Failed to load image for Page ${i}`;


            // Start analysis and add promise to the list
            analysisPromises.push(analyzePageImage(imageDataUrl, i));

        } catch (renderError) {
             console.error(`Error rendering page ${i}:`, renderError);
              totalPages--; // Decrement total pages if rendering fails, so analysis count matches renderable pages.
             // Add an error placeholder for this page
             const pageContainer = document.createElement('div');
             pageContainer.className = 'page-container page-error';
             pageContainer.innerHTML = `
                 <h2>Page ${i} - Render Error</h2>
                 <div class="error-message">Error rendering this page: ${renderError.message || 'Unknown render error'}</div>
             `;
             resultsDiv.appendChild(pageContainer);
             // We don't push an analysis promise for rendering errors
        }
    }

    // Check if any pages were successfully rendered to proceed with analysis status
    if (analysisPromises.length > 0) {
         showStatus(`Rendering complete. Waiting for AI analysis (0/${analysisPromises.length} pages analyzed)...`, true);
    } else if (totalPages === 0 && pdf.numPages > 0) {
        // This case means all pages failed to render
        showError('Failed to render any pages from the PDF.');
        totalPages = pdf.numPages; // Reset totalPages back for consistency if needed elsewhere
    } else if (pdf.numPages === 0){
         showStatus('PDF has no pages.', false);
         setTimeout(hideStatus, 3000);
    } else {
        // This case means totalPages was initially 0 or became 0 and no promises were pushed.
        // Essentially, PDF might be empty or failed very early.
         showStatus('No pages to analyze.', false);
         setTimeout(hideStatus, 3000);
    }


    // Wait for all analyses to complete
    try {
        await Promise.all(analysisPromises);
        // Final status update is handled within analyzePageImage after the last one finishes.
        // We could add a final confirmation here if needed, but the per-page update is likely sufficient.
        // showStatus(`All ${completedAnalyses} page analyses complete.`, false);
        // setTimeout(hideStatus, 4000); // Hide status after a delay
    } catch (analysisError) {
        // Individual errors are handled in analyzePageImage.
        // This catch block handles potential unexpected errors from Promise.all itself,
        // or if an error wasn't caught properly within analyzePageImage (though it should be).
        console.error("An error occurred during the analysis phase:", analysisError);
        // The main status will likely show the last successful count or an error message
        // from the failing promise. We can add a general error notice.
        showError("An error occurred during the analysis phase. Check individual pages for details.");
    }
}

async function analyzePageImage(imageDataUrl, pageNum) {
    const analysisDiv = document.getElementById(`analysis-${pageNum}`);
    if (!analysisDiv) {
        console.error(`Could not find analysis div for page ${pageNum}`);
        // Update global status even if div is missing, maybe?
        completedAnalyses++; // Count it as completed (with an error)
        updateAnalysisStatus();
        return; // Cannot display result
    }

    try {
        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            // Updated prompt for better structure/clarity
                            text: `Analyze the content of this image (representing a PDF page). Provide a structured description covering:
1.  **Text Summary:** Briefly summarize the main text content and key information points.
2.  **Layout & Structure:** Describe the arrangement of elements (text blocks, columns, images, headings, lists).
3.  **Visual Elements:** Detail any significant images, charts, graphs, tables, or diagrams. Note their purpose if clear.
4.  **Overall Topic/Purpose:** Infer the likely subject matter or function of this page within a larger document.`,
                        },
                        {
                            type: "image_url",
                            image_url: { url: imageDataUrl },
                        },
                    ],
                },
                 {
                    role: "system",
                    content: "You are an AI assistant analyzing PDF page images. Provide the analysis in a clear, structured format using markdown for headings and lists. Be concise yet informative."
                }
            ],
             // Consider adding max_tokens if responses are too long or getting cut off
             // max_tokens: 500 // Example: limit response length
        });

        // Use innerHTML to render markdown formatting (like lists, bold) from the LLM
        analysisDiv.innerHTML = completion.content || "No analysis returned.";
        analysisDiv.classList.remove('analyzing'); // Remove analyzing style

    } catch (error) {
        console.error(`Error analyzing page ${pageNum}:`, error);
        analysisDiv.innerHTML = `<strong>Analysis Error:</strong> ${error.message || 'Unknown AI error'}`; // Use innerHTML for consistency
        analysisDiv.classList.remove('analyzing');
        analysisDiv.classList.add('error'); // Add error style
        // Note: We don't re-throw the error here, allowing Promise.all to resolve even if some analyses fail.
        // Individual page errors are marked.
    } finally {
        // This block executes whether the try succeeded or failed
        completedAnalyses++;
        updateAnalysisStatus();
    }
}

function updateAnalysisStatus() {
    const pagesToAnalyze = totalPages - (totalPages - document.querySelectorAll('.analysis.analyzing, .analysis:not(.error):not(.analyzing)').length); // Recalculate based on actual rendered pages that will be analyzed
    const pagesSuccessfullyRenderedAndPotentiallyAnalyzed = document.querySelectorAll('.page-container:not(.page-error)').length;


    if (completedAnalyses < pagesSuccessfullyRenderedAndPotentiallyAnalyzed) {
         showStatus(`Analyzing page content (${completedAnalyses}/${pagesSuccessfullyRenderedAndPotentiallyAnalyzed} analyzed)...`, true);
    } else {
         // All expected analyses have finished (successfully or with error)
         const errorCount = document.querySelectorAll('.analysis.error').length;
         const successCount = completedAnalyses - errorCount;
         let finalMessage = `Analysis complete for ${pagesSuccessfullyRenderedAndPotentiallyAnalyzed} pages.`;
         if (errorCount > 0) {
             finalMessage += ` (${successCount} successful, ${errorCount} failed).`;
         }
         showStatus(finalMessage, false); // Hide spinner on completion
         setTimeout(hideStatus, 5000); // Hide status message after a delay
    }
}