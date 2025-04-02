import * as pdfjsLib from "pdfjs-dist/build/pdf.min.mjs";

// Specify the workerSrc explicitly
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.677/pdf.worker.min.mjs";

const pdfInput = document.getElementById('pdfInput');
const loadingText = document.getElementById('loading-text');
const statusSection = document.getElementById('status-section');
const resultsDiv = document.getElementById('results');
const fileNameDisplay = document.getElementById('file-name-display');
const errorMessageDiv = document.getElementById('error-message');

pdfInput.addEventListener('change', handleFileSelect);

function showStatus(message) {
    loadingText.textContent = message;
    statusSection.style.display = 'block';
    errorMessageDiv.style.display = 'none'; // Hide previous errors
}

function hideStatus() {
    statusSection.style.display = 'none';
}

function showError(message) {
    errorMessageDiv.textContent = message;
    errorMessageDiv.style.display = 'block';
    statusSection.style.display = 'block'; // Keep status section visible to show error
    loadingText.textContent = ''; // Clear loading text
    // Hide the spinner within the loading container if it exists
    const spinner = statusSection.querySelector('.spinner');
    if (spinner) spinner.style.display = 'none';
}

function hideError() {
    errorMessageDiv.style.display = 'none';
}

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) {
        fileNameDisplay.textContent = 'No file selected';
        return;
    }

    if (file.type !== 'application/pdf') {
        showError('Error: Please select a valid PDF file.');
        fileNameDisplay.textContent = 'Invalid file type';
        pdfInput.value = ''; // Reset file input
        return;
    }

    fileNameDisplay.textContent = `Selected: ${file.name}`;
    showStatus('Preparing to process PDF...');
    resultsDiv.innerHTML = ''; // Clear previous results
    hideError(); // Clear any previous errors

    try {
        const fileReader = new FileReader();
        fileReader.onload = async function() {
            const typedarray = new Uint8Array(this.result);
            await processPdf(typedarray);
            // Status update handled within processPdf
        };
        fileReader.onerror = () => {
             showError('Error reading the file.');
             hideStatus();
             pdfInput.value = ''; // Reset file input
             fileNameDisplay.textContent = 'Error reading file';
        };
        fileReader.readAsArrayBuffer(file);
    } catch (error) {
        console.error('Error setting up file reader:', error);
        showError('An unexpected error occurred while trying to read the file.');
        hideStatus();
        pdfInput.value = ''; // Reset file input
        fileNameDisplay.textContent = 'Error reading file';
    }
}

async function processPdf(pdfData) {
    let pdf;
    try {
        showStatus('Loading PDF document...');
        pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    } catch (error) {
        console.error('Error loading PDF document:', error);
        showError(`Error loading PDF: ${error.message || 'Unknown error'}`);
        hideStatus();
        return;
    }

    const numPages = pdf.numPages;
    showStatus(`Found ${numPages} pages. Starting analysis...`);

    const analysisPromises = [];

    for (let i = 1; i <= numPages; i++) {
        showStatus(`Processing page ${i} of ${numPages}...`);
        try {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 }); // Scale for better image quality

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };
            await page.render(renderContext).promise;

            const imageDataUrl = canvas.toDataURL('image/png');

            // Display the page container immediately
            const pageContainer = document.createElement('div');
            pageContainer.className = 'page-container';
            pageContainer.innerHTML = `
                <h2>Page ${i}</h2>
                <div class="page-content">
                    <img src="${imageDataUrl}" alt="Page ${i} Image">
                    <div class="analysis-section">
                        <h3>AI Analysis:</h3>
                        <div class="analysis analyzing" id="analysis-${i}">Analyzing page content...</div>
                    </div>
                </div>
            `;
            resultsDiv.appendChild(pageContainer);

            // Start analysis and add promise to the list
            analysisPromises.push(analyzePageImage(imageDataUrl, i));

        } catch (renderError) {
             console.error(`Error rendering page ${i}:`, renderError);
             // Add an error placeholder for this page
             const pageContainer = document.createElement('div');
             pageContainer.className = 'page-container';
             pageContainer.innerHTML = `
                 <h2>Page ${i}</h2>
                 <div class="error-message">Error rendering this page: ${renderError.message || 'Unknown render error'}</div>
             `;
             resultsDiv.appendChild(pageContainer);
             // We don't push an analysis promise for rendering errors
        }
    }

    // Wait for all analyses to complete
    showStatus(`Waiting for AI analysis (${numPages} pages)...`);
    try {
        await Promise.all(analysisPromises);
        showStatus(`Analysis complete for ${numPages} pages.`);
         // Optionally hide status after a delay or keep it
         setTimeout(hideStatus, 3000); // Hide after 3 seconds
    } catch (analysisError) {
        // Errors from analyzePageImage are handled individually within that function,
        // but a catch block here can handle potential Promise.all rejection issues if needed.
        console.error("An error occurred during the analysis phase:", analysisError);
        showError("An error occurred during the analysis phase. Some pages might not be analyzed.");
        // Don't hide status immediately, let user see the error
    }
}

async function analyzePageImage(imageDataUrl, pageNum) {
    const analysisDiv = document.getElementById(`analysis-${pageNum}`);
    if (!analysisDiv) {
        console.error(`Could not find analysis div for page ${pageNum}`);
        return; // Should not happen if rendering was successful
    }

    try {
        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Describe the content of this image (representing a PDF page) in detail. Include:\n1. **Text Summary:** Briefly summarize the main text content.\n2. **Layout Description:** Describe the arrangement of elements (text blocks, images, headings).\n3. **Visual Elements:** Mention any significant images, charts, or figures.\n4. **Overall Purpose:** Infer the likely purpose or topic of this page.",
                        },
                        {
                            type: "image_url",
                            image_url: { url: imageDataUrl },
                        },
                    ],
                },
                 {
                    role: "system",
                    content: "Provide the analysis in a clear, structured format. Use markdown for headings or lists if appropriate, but keep the response concise yet informative."
                }
            ],
        });

        analysisDiv.textContent = completion.content || "No analysis returned.";
        analysisDiv.classList.remove('analyzing'); // Remove analyzing style

    } catch (error) {
        console.error(`Error analyzing page ${pageNum}:`, error);
        analysisDiv.textContent = `Error analyzing this page: ${error.message || 'Unknown AI error'}`;
        analysisDiv.classList.remove('analyzing');
        analysisDiv.classList.add('error'); // Add error style
        // We throw the error so Promise.all can potentially catch it if needed,
        // although individual errors are already displayed.
        throw error;
    }
}