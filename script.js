document.querySelectorAll('.sidebar li').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(item.dataset.view).classList.add('active');
    });
});

function updateTime() {
    const now = new Date();
    const formatted = now.toLocaleDateString('nl-NL') + ' ' + now.toLocaleTimeString('nl-NL');
    document.getElementById('datetime').textContent = formatted;
}
setInterval(updateTime, 1000);
updateTime();
