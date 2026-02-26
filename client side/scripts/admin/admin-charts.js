class ChartManager {
    constructor() {
        this.charts = {};
    }
    
    destroyChart(chartName) {
        if (this.charts[chartName]) {
            this.charts[chartName].destroy();
            delete this.charts[chartName];
        }
    }
    
    destroyAllCharts() {
        Object.keys(this.charts).forEach(name => this.destroyChart(name));
    }
    
    createFrequencyChart(statistics, canvasId = 'frequency-chart') {
        const frequencyData = {};
        
        statistics.forEach(stat => {
            if (!frequencyData[stat.frequency]) {
                frequencyData[stat.frequency] = 0;
            }
            frequencyData[stat.frequency] += parseInt(stat.count);
        });
        
        if (Object.keys(frequencyData).length === 0) {
            this.showNoData(canvasId);
            return;
        }
        
        const labels = Object.keys(frequencyData);
        const data = Object.values(frequencyData);
        const colors = this.generateColors(labels.length);
        
        this.destroyChart('frequencyChart');
        
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        
        this.charts.frequencyChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors.backgrounds,
                    borderColor: colors.borders,
                    borderWidth: 1
                }]
            },
            options: this.getBaseOptions('Распределение выборов по частотам')
        });
    }
    
    createChoicesChart(statistics, canvasId = 'choices-chart') {
        const choiceGroups = {};
        
        statistics.forEach(stat => {
            const key = `${stat.frequency}-${stat.choice_id}`;
            if (!choiceGroups[key]) {
                choiceGroups[key] = {
                    label: `${stat.frequency}: ${stat.choice_text || stat.choice_id}`,
                    total: 0
                };
            }
            choiceGroups[key].total += parseInt(stat.count);
        });
        
        const sortedChoices = Object.values(choiceGroups)
            .sort((a, b) => b.total - a.total)
            .slice(0, 10);
        
        if (sortedChoices.length === 0) {
            this.showNoData(canvasId);
            return;
        }
        
        const colors = this.generateColors(sortedChoices.length);
        
        this.destroyChart('choicesChart');
        
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        
        this.charts.choicesChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sortedChoices.map(c => c.label),
                datasets: [{
                    label: 'Количество выборов',
                    data: sortedChoices.map(c => c.total),
                    backgroundColor: colors.backgrounds,
                    borderColor: colors.borders,
                    borderWidth: 1
                }]
            },
            options: {
                ...this.getBaseOptions('Топ-10 популярных выборов'),
                plugins: { ...this.getBaseOptions().plugins, legend: { display: false } },
                scales: this.getChartScales()
            }
        });
    }
    
    createProgressChart(progressData, canvasId = 'progress-chart') {
        if (!progressData || progressData.length === 0) {
            this.showNoData(canvasId);
            return;
        }
        
        const frequencyGroups = {};
        
        progressData.forEach(progress => {
            if (!progress.frequency) return;
            
            if (!frequencyGroups[progress.frequency]) {
                frequencyGroups[progress.frequency] = { 
                    notStarted: 0, 
                    inProgress: 0, 
                    completed: 0,
                    replay: 0 
                };
            }
            
            if (progress.status === 'Не начато') {
                frequencyGroups[progress.frequency].notStarted++;
            } else if (progress.status === 'В процессе') {
                frequencyGroups[progress.frequency].inProgress++;
            } else if (progress.status === 'Да') {
                frequencyGroups[progress.frequency].completed++;
            } else if (progress.status === 'Да (перепрохождение)') {
                frequencyGroups[progress.frequency].replay++;
            }
        });
        
        if (Object.keys(frequencyGroups).length === 0) {
            this.showNoData(canvasId);
            return;
        }
        
        const labels = Object.keys(frequencyGroups);
        const notStartedData = labels.map(f => frequencyGroups[f].notStarted);
        const inProgressData = labels.map(f => frequencyGroups[f].inProgress);
        const completedData = labels.map(f => frequencyGroups[f].completed);
        const replayData = labels.map(f => frequencyGroups[f].replay);
        
        this.destroyChart('progressChart');
        
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        
        this.charts.progressChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Не начато',
                        data: notStartedData,
                        backgroundColor: 'rgba(128, 128, 128, 0.7)',
                        borderColor: 'rgba(128, 128, 128, 1)',
                        borderWidth: 1
                    },
                    {
                        label: 'В процессе',
                        data: inProgressData,
                        backgroundColor: 'rgba(255, 193, 7, 0.7)',
                        borderColor: 'rgba(255, 193, 7, 1)',
                        borderWidth: 1
                    },
                    {
                        label: 'Завершено',
                        data: completedData,
                        backgroundColor: 'rgba(3, 251, 141, 0.7)',
                        borderColor: 'rgba(3, 251, 141, 1)',
                        borderWidth: 1
                    },
                    {
                        label: 'Перепрохождение',
                        data: replayData,
                        backgroundColor: 'rgba(0, 123, 255, 0.7)',
                        borderColor: 'rgba(0, 123, 255, 1)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        title: { display: true, text: 'Частота', color: '#03FB8D' },
                        ticks: { color: '#03FB8D' },
                        grid: { color: 'rgba(3, 251, 141, 0.1)' }
                    },
                    y: {
                        stacked: true,
                        title: { display: true, text: 'Пользователи', color: '#03FB8D' },
                        ticks: { color: '#03FB8D', beginAtZero: true, stepSize: 1 },
                        grid: { color: 'rgba(3, 251, 141, 0.1)' }
                    }
                },
                plugins: {
                    legend: { labels: { color: '#03FB8D' } },
                    title: { display: true, text: 'Прогресс по частотам', color: '#03FB8D' }
                }
            }
        });
    }
    
    createDetailChart(options, canvasId = 'detail-chart') {
        const labels = options.map(o => o.text);
        const data = options.map(o => o.count);
        const colors = this.generateColors(options.length);
        
        this.destroyChart('detailChart');
        
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        
        this.charts.detailChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors.backgrounds,
                    borderColor: colors.borders,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { color: '#03FB8D', font: { size: 12 } }
                    },
                    title: { display: true, text: 'Распределение ответов', color: '#03FB8D' },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percent = Math.round((context.raw / total) * 100);
                                return `${context.label}: ${context.raw} (${percent}%)`;
                            }
                        }
                    }
                }
            }
        });
    }
    
    generateColors(count) {
        const backgrounds = [];
        const borders = [];
        
        const baseColors = [
            'rgba(3, 251, 141, 0.7)',
            'rgba(75, 192, 192, 0.7)',
            'rgba(153, 102, 255, 0.7)',
            'rgba(255, 159, 64, 0.7)',
            'rgba(255, 99, 132, 0.7)'
        ];
        
        const baseBorders = [
            'rgba(3, 251, 141, 1)',
            'rgba(75, 192, 192, 1)',
            'rgba(153, 102, 255, 1)',
            'rgba(255, 159, 64, 1)',
            'rgba(255, 99, 132, 1)'
        ];
        
        for (let i = 0; i < count; i++) {
            if (i < baseColors.length) {
                backgrounds.push(baseColors[i]);
                borders.push(baseBorders[i]);
            } else {
                const hue = (i * 137.5) % 360;
                backgrounds.push(`hsla(${hue}, 70%, 60%, 0.7)`);
                borders.push(`hsla(${hue}, 70%, 60%, 1)`);
            }
        }
        
        return { backgrounds, borders };
    }
    
    getBaseOptions(title) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#03FB8D' }
                },
                title: {
                    display: true,
                    text: title,
                    color: '#03FB8D'
                }
            }
        };
    }
    
    getChartScales() {
        return {
            y: {
                beginAtZero: true,
                ticks: { color: '#03FB8D' },
                grid: { color: 'rgba(3, 251, 141, 0.1)' }
            },
            x: {
                ticks: { color: '#03FB8D' },
                grid: { color: 'rgba(3, 251, 141, 0.1)' }
            }
        };
    }
    
    showNoData(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (canvas) {
            canvas.innerHTML = '<div class="no-data">Нет данных для отображения</div>';
        }
    }
}

export default ChartManager;
