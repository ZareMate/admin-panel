import PeopleAltOutlined from '@mui/icons-material/PeopleAltOutlined';
import SportsKabaddiOutlined from '@mui/icons-material/SportsKabaddiOutlined';
import MapOutlined from '@mui/icons-material/MapOutlined';
import DonutLargeOutlined from '@mui/icons-material/DonutLargeOutlined';
import SecurityOutlined from '@mui/icons-material/SecurityOutlined';
import ConfirmationNumberOutlined from '@mui/icons-material/ConfirmationNumberOutlined';
import ChecklistOutlined from '@mui/icons-material/ChecklistOutlined';
import LightbulbOutlined from '@mui/icons-material/LightbulbOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import ManageAccountsOutlined from '@mui/icons-material/ManageAccountsOutlined';
import AccountCircleOutlined from '@mui/icons-material/AccountCircleOutlined';
import GavelOutlined from '@mui/icons-material/GavelOutlined';
import StickyNote2Outlined from '@mui/icons-material/StickyNote2Outlined';
import PolicyOutlined from '@mui/icons-material/PolicyOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import AllInboxOutlined from '@mui/icons-material/AllInboxOutlined';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
const icons={players:PeopleAltOutlined,killFeed:SportsKabaddiOutlined,map:MapOutlined,stats:DonutLargeOutlined,tsa:SecurityOutlined,
 tickets:ConfirmationNumberOutlined,todo:ChecklistOutlined,suggestions:LightbulbOutlined,audit:HistoryOutlined,access:ManageAccountsOutlined,
 overview:AccountCircleOutlined,cases:GavelOutlined,notes:StickyNote2Outlined,security:PolicyOutlined,inventory:Inventory2Outlined,enderChest:AllInboxOutlined,curios:AutoAwesomeOutlined};
export type TabIconName=keyof typeof icons;
export function TabIcon({name}:{name:TabIconName}) {
 const Icon=icons[name];return <Icon className="tab-icon" fontSize="small" aria-hidden="true" focusable="false"/>;
}
