
import './FileList.css';

export default {

    functional: true,
    
    props: {
        fileList: {
            type: Array,
            default: () => []
        },
        isUplod: {
            type: Boolean,
            default: false
        }
    },
    
    render(_, {props}) {

        const {fileList} = props
        return (<section class={"list"}>
            <ul>
                {fileList.map(file =>  
                    (<li class={"item"}>
                        <p class={'file-name'}>{file.name}</p>
                        {
                            file.isUpload 
                            ? <progress class={'upload-progress'} min="0" max="100" value={file.onPercent}/>
                            : ''
                        }
                        {
                            file.isUpload 
                            ? (file.onPercent > 0 && file.onPercent <= 100)  
                                ? <span class="percent">已上传 {file.onPercent.toFixed(0)}%</span>
                                : <span class='waiting'>waiting...</span>
                            : file.onPercent !== 0 
                                ? file.onPercent >= 100
                                    ?<span class={'success'}>done!</span> 
                                    : <span class={'fail'}>fail!</span>
                                : ''
                        }
                    </li>)
                )}
            </ul>
        </section>)
    }
}
