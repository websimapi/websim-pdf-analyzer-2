import * as pdfjsLib from "pdfjs-dist/build/pdf.min.mjs";

// Specify the workerSrc explicitly
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.677/pdf.worker.min.mjs";

const pdfInput = document.getElementById('pdfInput');
const loadingDiv = document.getElementById('loading');
const resultsDiv = document.getElementById('results');

pdfInput.addEventListener('change', handleFileSelect);

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') {
        alert('Please select a PDF file.');
        return;
    }

    loadingDiv.style.display = 'block';
    resultsDiv.innerHTML = ''; // Clear previous results

    try {
        const fileReader = new FileReader();
        fileReader.onload = async function() {
            const typedarray = new Uint8Array(this.result);
            await processPdf(typedarray);
            loadingDiv.style.display = 'none';
        };
        fileReader.readAsArrayBuffer(file);
    } catch (error) {
        console.error('Error processing PDF:', error);
        alert('An error occurred while processing the PDF.');
        loadingDiv.style.display = 'none';
    }
}

async function processPdf(pdfData) {
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const numPages = pdf.numPages;

    for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 }); // Increase scale for better image quality

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

        // Display the page image and analysis container
        const pageContainer = document.createElement('div');
        pageContainer.className = 'page-container';
        pageContainer.innerHTML = `
            <h2>Page ${i}</h2>
            <img src="${imageDataUrl}" alt="Page ${i} Image">
            <div class="analysis" id="analysis-${i}">Analyzing page content...</div>
        `;
        resultsDiv.appendChild(pageContainer);

        // Send image to LLM for analysis
        await analyzePageImage(imageDataUrl, i);
    }
}

async function analyzePageImage(imageDataUrl, pageNum) {
    const analysisDiv = document.getElementById(`analysis-${pageNum}`);
    try {
        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Describe the content of this image in as much detail as possible. What text is visible? What is the layout? What objects or figures are present? What is the overall topic or purpose of this page?",
                        },
                        {
                            type: "image_url",
                            image_url: { url: imageDataUrl },
                        },
                    ],
                },
            ],
        });

        analysisDiv.textContent = completion.content;

    } catch (error) {
        console.error(`Error analyzing page ${pageNum}:`, error);
        analysisDiv.textContent = 'Error analyzing this page.';
        analysisDiv.style.backgroundColor = '#ffebee'; // Indicate error visually
        analysisDiv.style.borderColor = '#f44336';
    }
}

