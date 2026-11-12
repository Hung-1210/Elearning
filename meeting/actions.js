const toggleChatButton = document.getElementById('toggle-chat-button');
const chatPanel = document.getElementById('chat-panel');
const videoGridWrapper = document.getElementById('video-grid-wrapper');
// const videoGrid = document.getElementById('video-grid');
const chatPanelClose = document.getElementById('chat-panel-close');
const chatContent = document.getElementById('chat-content');
chatContent.innerHTML = '';

toggleChatButton.addEventListener('click', () => {
    chatPanel.classList.toggle('open');
    toggleChatButton.classList.toggle('active');
});

chatPanelClose.addEventListener('click', () => {
    chatPanel.classList.remove('open');
    toggleChatButton.classList.remove('active');
});

// Thêm sự kiện cho việc double click để pin video
document.querySelectorAll('.video-wrapper').forEach(e => {
    e.addEventListener('dblclick', () => {
        e.classList.toggle('pin');
        // Nếu video được pin, đưa nó lên đầu
        if (e.classList.contains('pin')) {
            videoGridWrapper.prepend(e);  // Di chuyển phần tử lên đầu
        } else {
            videoGrid.appendChild(e); // Đưa phần tử về cuối
        }
        videoGridWrapper.scrollTop = 0;
    });
});

function pinVideo(video) {
    const p = video.parentElement;
    p.classList.add('pin');
    videoGridWrapper.prepend(p);
}

function unPinVideo(video) {
    const p = video.parentElement;
    p.classList.remove('pin');
    videoGrid.insertBefore(p, videoGrid.firstChild);
}

const chatContainer = document.getElementById('chat-content');
const chatForm = document.getElementById('chat-form');
const userOutput = document.getElementById('chat-text');
const sendButton = document.getElementById('chat-send');

sendButton.addEventListener('click', onSendMessage);
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    onSendMessage();
})

function onSendMessage() {
    sendMessage(userOutput.value);
    userOutput.value = null;
}

function sendMessage(message) {
    if(!message) return;
    const box = document.createElement('div');
    box.className = 'message outgoing';
    box.textContent = message;
    box.setAttribute('sender', userName);
    chatContainer.appendChild(box);
    chatContainer.scrollTo({
        top: chatContainer.scrollHeight,
        behavior: "smooth"
    });
    broadcastData({ type: 'MESSAGE', sender: userName, message });
}

function receiveMessage(message, sender) {
    const box = document.createElement('div');
    box.className = 'message incoming';
    box.textContent = message;
    box.setAttribute('sender', sender);
    chatContainer.appendChild(box);
    chatContainer.scrollTo({
        top: chatContainer.scrollHeight,
        behavior: "smooth"
    });
}

/**
 * @param {string} message 
 */
function showPopup(message) {
    const popup = document.getElementById('popup');
    const messageElement = document.getElementById('popup-message');
    const closeButton = document.getElementById('popup-close-btn');

    messageElement.textContent = message;
    popup.style.display = 'block';

    closeButton.onclick = () => {
        popup.style.display = 'none';
    };

    setTimeout(() => {
        popup.style.display = 'none';
    }, 5000);
}